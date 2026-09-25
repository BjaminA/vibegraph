// M-LANG4 (PLAN-M-LANG.md) — the bash IR builder, extracted from
// parse_bash.mjs so the rewriter resolves structural IDs from the SAME
// code that mints them (the parse_cst.GraphBuilder ↔ cst_rewrite
// pattern: parser, ID grammar, and rewriter are one object per
// language; a second copy would drift).
//
// The builder records BYTE SPANS per emitted node (`spans`:
// id → {start, end, bodyStart?, bodyEnd?}) — the rewriter's splice
// targets. parse_bash.mjs drops them at the IR boundary (spans are a
// rewrite-time concern, not IR).
//
// Mapping + honesty rules are documented in parse_bash.mjs (the CLI).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Parser, Language } from "web-tree-sitter";
import { effectKindForCommand, isDynamicCallee, SKIP_BUILTINS } from "./tables.mjs";
import { docFromComments } from "../doc_comments.mjs";
import { topLevelDescendants } from "../nests.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR = join(HERE, "..", "grammars", "tree-sitter-bash.wasm");
const PREVIEW_MAX = 80;
// M-CONTRACT.1 — bash's nested call is the command substitution
// (`echo "$(date)"`, `X=$(dirname $(pwd))`): the substituted command is
// a real call the outer statement would otherwise mask.
const SUBST_TYPES = new Set(["command_substitution"]);

let parser = null;
export async function getParser() {
  if (!parser) {
    await Parser.init();
    const lang = await Language.load(GRAMMAR);
    parser = new Parser();
    parser.setLanguage(lang);
  }
  return parser;
}

export class BashGraphBuilder {
  constructor(source) {
    this.source = source;
    this.nodes = [];
    this.edges = [];
    this.symbolIndex = [];
    this.functionIds = new Map(); // name → node id (same-file reference pass)
    this.callSites = [];          // { id, funcName }
    // Per-parent occurrence counters, mirroring parse_cst.py:_make_id:
    // named segs get '@k' only for k>0; nameless segs count per kind.
    this.counters = new Map();    // `${parentId} ${seg}` → count
    // M-LANG4 — byte spans per emitted node id, for the rewriter's
    // splice. IDs are NOT unique (sibling collisions are legal — see
    // vibegraph-ir); first emission wins, matching the resolution rule.
    this.spans = new Map();
    this.dropped = 0;
  }

  text(n) { return this.source.slice(n.startIndex, n.endIndex); }

  makeId(parentId, base) {
    const key = `${parentId ?? "module"} ${base}`;
    const k = this.counters.get(key) ?? 0;
    this.counters.set(key, k + 1);
    const seg = k === 0 ? base : `${base}@${k}`;
    return parentId ? `${parentId}/${seg}` : `module/${seg}`;
  }

  makeAnonId(parentId, kind) {
    const key = `${parentId ?? "module"} @${kind}`;
    const k = this.counters.get(key) ?? 0;
    this.counters.set(key, k + 1);
    const seg = `${kind}@${k}`;
    return parentId ? `${parentId}/${seg}` : `module/${seg}`;
  }

  emit(node, parentId, tsNode) {
    this.nodes.push(node);
    if (parentId) {
      this.edges.push({ source: parentId, target: node.id, type: "contains" });
    }
    if (tsNode && !this.spans.has(node.id)) {
      this.spans.set(node.id, { start: tsNode.startIndex, end: tsNode.endIndex });
    }
  }

  pos(n) {
    return {
      line: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
      col: n.startPosition.column,
      endCol: n.endPosition.column,
    };
  }

  // Flatten dots the way parse_cst.py does (names never carry '.', it is
  // the kind separator), forbid '/' (the ID path separator), and strip
  // shell punctuation ("$CMD" would otherwise leak quotes into the ID —
  // the node's funcName keeps the raw text; only the ID is sanitised).
  safeName(name) {
    return name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "_";
  }

  walkChildren(node, parentId) {
    for (const child of node.namedChildren) this.visit(child, parentId);
  }

  visit(n, parentId) {
    // Never emit garbage IR: a tree-sitter ERROR/MISSING region is dropped
    // and counted — but a severe error SWALLOWS neighbouring healthy
    // constructs as ERROR children (probed against tree-sitter-bash
    // 0.25), so recurse into them: well-formed sub-constructs are kept,
    // the unrecognisable remainder falls through the default case.
    // hasError propagates UP to the root, so containers still recurse
    // (only the actual broken constructs are lost) while emitting
    // constructs (commands, assignments, pipelines) drop wholesale.
    if (n.isMissing) { this.dropped += 1; return; }
    if (n.type === "ERROR") { this.dropped += 1; return this.walkChildren(n, parentId); }
    const isEmitting = n.type === "command" || n.type === "pipeline"
      || n.type === "variable_assignment" || n.type === "declaration_command"
      || n.type === "unset_command";
    if (isEmitting && n.hasError) { this.dropped += 1; return; }
    switch (n.type) {
      case "program": case "compound_statement": case "do_group":
      case "list": case "subshell": // subshell flattens: NAMED LIMIT
        return this.walkChildren(n, parentId);
      case "redirected_statement": { // unwrap `cmd > file`, `while …; done < f`
        const body = n.childForFieldName("body") ?? n.namedChildren[0];
        // The REDIRECT TARGET can itself be a command: `cmd > "$(path)"`.
        for (const c of n.namedChildren) {
          if (!body || c.id !== body.id) this.walkSubstitutions(c, parentId);
        }
        return body ? this.visit(body, parentId) : undefined;
      }
      case "function_definition": return this.visitFunction(n, parentId);
      case "command": return this.visitCommand(n, parentId);
      case "pipeline": return this.visitPipeline(n, parentId);
      case "variable_assignment": return this.visitAssignment(n, parentId);
      case "declaration_command": case "unset_command": {
        for (const c of n.namedChildren) {
          if (c.type === "variable_assignment") this.visitAssignment(c, parentId);
        }
        return;
      }
      case "if_statement": return this.visitIf(n, parentId);
      case "case_statement": return this.visitCase(n, parentId);
      case "while_statement": return this.visitWhile(n, parentId); // until parses as while
      case "for_statement": case "c_style_for_statement":
        return this.visitFor(n, parentId);
      case "negated_command":
        return this.walkChildren(n, parentId);
      default:
        // comments, test_command, heredocs, arithmetic — none of these
        // is a thread step of its own. But any of them can CONTAIN a
        // substitution, and a substitution is a command that runs:
        // `[[ -f "$(probe)" ]]` and `(( $(count) > 1 ))` used to mint
        // nothing at all. Walking here rather than adding a case per
        // node type keeps the rule general — an unmodelled construct
        // may cost its own node, never the commands inside it.
        return this.walkSubstitutions(n, parentId);
    }
  }

  visitFunction(n, parentId) {
    const nameNode = n.childForFieldName("name") ?? n.namedChildren.find((c) => c.type === "word");
    const name = nameNode ? this.text(nameNode) : "_";
    const id = this.makeId(parentId, `${this.safeName(name)}.fn`);
    const p = this.pos(n);
    // PARITY with the Python IR (fields already in the 2.0 schema):
    //  * docstring ← the contiguous comment block above the function —
    //    bash's authored description, and what the thread step preview,
    //    launchpad summary, and explain/skills quote;
    //  * params ← DERIVED from positional usage: `local dest=$1` names
    //    the parameter, bare $2 usage keeps the positional form, "$@"
    //    alone means the function forwards everything. Derived, so the
    //    signature says what the body actually consumes.
    // decorators/isAsync stay absent — bash has no such concepts.
    const docstring = docFromComments(n, this.source);
    const params = this.deriveParams(n.childForFieldName("body"));
    this.emit({ id, type: "function_def", parentId: parentId ?? null, ...p, name, params, docstring }, parentId, n);
    this.functionIds.set(name, id);
    this.symbolIndex.push({
      sym: `function:${name}`,
      kind: "function",
      name,
      scope: parentId ?? "module",
      loc: { line: p.line, endLine: p.endLine, col: p.col, endCol: p.endCol },
      signature: `${name}(${params.join(", ")})`,
      docstring,
      source: this.text(n),
    });
    const body = n.childForFieldName("body");
    if (body) {
      // M-LANG4 — record the body span for replace_function_body.
      const span = this.spans.get(id);
      if (span) { span.bodyStart = body.startIndex; span.bodyEnd = body.endIndex; }
      this.visit(body, id);
    }
  }

  // Derive a bash function's parameter list from its body: positions
  // named by `local x=$1` / `x="$2"` keep the name, other referenced
  // positions keep the positional form, and a body that only touches
  // "$@"/"$*" declares exactly that. Capped at $9 (past that is ${10}
  // territory nobody writes by hand).
  deriveParams(bodyNode) {
    if (!bodyNode) return [];
    const body = this.text(bodyNode);
    const named = new Map();
    for (const m of body.matchAll(/(?:local\s+|declare\s+(?:-\w+\s+)*)?([A-Za-z_]\w*)=["']?\$\{?([1-9])\}?["']?/g)) {
      const pos = Number(m[2]);
      if (!named.has(pos)) named.set(pos, m[1]);
    }
    let max = 0;
    for (const m of body.matchAll(/\$\{?([1-9])\}?/g)) max = Math.max(max, Number(m[1]));
    if (max === 0) return /\$[@*]/.test(body) ? ['"$@"'] : [];
    const out = [];
    for (let i = 1; i <= max; i++) out.push(named.get(i) ?? `$${i}`);
    return out;
  }

  commandWord(n) {
    const nameNode = n.childForFieldName("name");
    return nameNode ? this.text(nameNode) : null;
  }

  commandArgs(n) {
    const args = [];
    for (const c of n.namedChildren) {
      if (c.type === "command_name" || c.type === "variable_assignment") continue;
      args.push(this.text(c));
    }
    return args;
  }

  visitCommand(n, parentId) {
    const word = this.commandWord(n);
    if (word === null) {
      // `X=1 cmd`-style prefix assignments with no command name
      for (const c of n.namedChildren) {
        if (c.type === "variable_assignment") this.visitAssignment(c, parentId);
      }
      return;
    }
    const args = this.commandArgs(n);
    if (word === "source" || word === ".") return this.visitSource(n, parentId, args);
    if (word === "return" || word === "exit") {
      // `exit "$(code_for "$1")"` — the substitution runs first.
      this.walkSubstitutions(n, parentId);
      const id = this.makeAnonId(parentId, "return");
      this.emit({ id, type: "return_stmt", parentId: parentId ?? null, ...this.pos(n), value: args[0] ?? null }, parentId, n);
      return;
    }
    if (SKIP_BUILTINS.has(word)) {
      // cd/set/shift/… are never a thread step — but a SUBSTITUTION in
      // their words is still a command that runs, and skipping the
      // builtin used to throw it away with the line. `cd "$(dirname
      // "$0")"` opens half the scripts in this repo.
      this.walkSubstitutions(n, parentId);
      return;
    }
    // Prefix assignments still bind (`VAR=x cmd`)
    for (const c of n.namedChildren) {
      if (c.type === "variable_assignment") this.visitAssignment(c, parentId);
    }
    const id = this.makeId(parentId, `${this.safeName(word)}.call`);
    const node = {
      id, type: "call", parentId: parentId ?? null, ...this.pos(n),
      funcName: word, args, isEffect: false,
    };
    const effect = effectKindForCommand(word);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId, n);
    if (!isDynamicCallee(word)) this.callSites.push({ id, funcName: word });
    this.stampNests(n, node, id);
    return id;
  }

  // M-CONTRACT.1 — M-NEST Layer 1 parity for bash: every command
  // substitution nested in this command's words is either MINTED as a
  // `nested` call node (parented at the outer node) or, when its inner
  // command has no resolvable word, FLAGGED (nestsInnerCalls without
  // nestExtracted). `root` is the outer command node, or the inner
  // command of a `X=$(…)` assignment.
  stampNests(root, node, outerId) {
    const subs = topLevelDescendants(root, SUBST_TYPES);
    if (subs.length === 0) return;
    node.nestsInnerCalls = true;
    let minted = 0;
    for (const s of subs) minted += this.emitNestedSubstitution(s, outerId, 1);
    node.nestExtracted = minted > 0;
  }

  /**
   * Every `$(…)` written under `node`, minted where it runs.
   *
   * The bash spelling of the M-SWEEP expression walk: a substitution is
   * a COMMAND, and it runs wherever it is written — in a string, an
   * array, a redirect target, a `for` list, a test. Only two positions
   * used to reach one, so `cd "$(dirname "$0")"` and
   * `msg="text $(get_val)"` produced nothing at all.
   *
   * `depth` 0 mints a PLAIN call (it is not nested inside another call
   * this IR names); deeper levels keep the `nested` marking that the
   * default projection collapses.
   */
  walkSubstitutions(node, parentId) {
    if (!node) return;
    // topLevelDescendants looks STRICTLY BELOW its root, so a value that
    // IS the substitution — `for x in $(list_cmd)` — matched nothing.
    if (SUBST_TYPES.has(node.type)) {
      this.emitNestedSubstitution(node, parentId, 0);
      return;
    }
    for (const s of topLevelDescendants(node, SUBST_TYPES)) {
      this.emitNestedSubstitution(s, parentId, 0);
    }
  }

  /** The first COMMAND inside a substitution, whatever wraps it. A
   *  `$(cd x && pwd)` body is a `list`, a `$(cmd > /dev/null)` body is a
   *  `redirected_statement`, and looking only for a bare command or
   *  pipeline found neither — so the whole substitution was dropped. */
  firstCommandIn(node, seen = 0) {
    if (!node || seen > 6) return null;
    if (node.type === "command") return node;
    for (const c of node.namedChildren) {
      const hit = this.firstCommandIn(c, seen + 1);
      if (hit) return hit;
    }
    return null;
  }

  emitNestedSubstitution(subst, parentId, depth) {
    const cmd = this.firstCommandIn(subst);
    const word = cmd ? this.commandWord(cmd) : null;
    // A skipped builtin is not a step, but a substitution in ITS words
    // still runs — `$(cd "$(dirname "$0")" && pwd)` is the shape.
    if (!word || SKIP_BUILTINS.has(word)) {
      let n = 0;
      for (const inner of topLevelDescendants(subst, SUBST_TYPES)) {
        n += this.emitNestedSubstitution(inner, parentId, depth);
      }
      // …and so does any LATER command in the same list.
      if (cmd) {
        for (const sib of this.commandsAfter(subst, cmd)) {
          n += this.emitCommandInSubstitution(sib, parentId, depth);
        }
      }
      return n;
    }
    const id = this.makeId(parentId, `${this.safeName(word)}.call`);
    const node = {
      id, type: "call", parentId, ...this.pos(cmd),
      funcName: word, args: this.commandArgs(cmd), isEffect: false,
      callTarget: word, preview: this.text(subst).slice(0, PREVIEW_MAX),
      ...(depth > 0 ? { nested: true, nestedDepth: depth } : {}),
    };
    const effect = effectKindForCommand(word);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId, cmd);
    if (!isDynamicCallee(word)) this.callSites.push({ id, funcName: word });
    let minted = 1;
    for (const s of topLevelDescendants(cmd, SUBST_TYPES)) {
      minted += this.emitNestedSubstitution(s, id, depth + 1);
    }
    // `$(a && b)` / `$(a | b)` — every command in the body runs.
    for (const sib of this.commandsAfter(subst, cmd)) {
      minted += this.emitCommandInSubstitution(sib, parentId, depth);
    }
    return minted;
  }

  /** Every COMMAND inside `subst` other than `first`, in source order. */
  commandsAfter(subst, first) {
    const out = [];
    const walk = (n) => {
      if (n.type === "command") { if (n.id !== first.id) out.push(n); return; }
      if (SUBST_TYPES.has(n.type) && n.id !== subst.id) return; // its own nest
      for (const c of n.namedChildren) walk(c);
    };
    walk(subst);
    return out;
  }

  /** Mint one command found inside a substitution body. */
  emitCommandInSubstitution(cmd, parentId, depth) {
    const word = this.commandWord(cmd);
    if (!word || SKIP_BUILTINS.has(word)) {
      let n = 0;
      for (const inner of topLevelDescendants(cmd, SUBST_TYPES)) {
        n += this.emitNestedSubstitution(inner, parentId, depth);
      }
      return n;
    }
    const id = this.makeId(parentId, `${this.safeName(word)}.call`);
    const node = {
      id, type: "call", parentId, ...this.pos(cmd),
      funcName: word, args: this.commandArgs(cmd), isEffect: false,
      callTarget: word, preview: this.text(cmd).slice(0, PREVIEW_MAX),
      ...(depth > 0 ? { nested: true, nestedDepth: depth } : {}),
    };
    const effect = effectKindForCommand(word);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId, cmd);
    if (!isDynamicCallee(word)) this.callSites.push({ id, funcName: word });
    let minted = 1;
    for (const s of topLevelDescendants(cmd, SUBST_TYPES)) {
      minted += this.emitNestedSubstitution(s, id, depth + 1);
    }
    return minted;
  }

  /**
   * A CONDITION, which in shell is itself a command.
   *
   * `if check_token "$1"` and `while read -r line` run a real command to
   * decide; the condition's TEXT was kept and no node was minted, which
   * is the same hole the python floor closed on 2026-09-10 and the same
   * one the JS/TS walk closed for `if (checkToken(req))`. A
   * `test_command` (`[ -n "$x" ]`) is the shell's own builtin and stays
   * unminted — only what it SUBSTITUTES runs.
   */
  walkConditionCommands(cond, parentId) {
    if (!cond) return;
    if (cond.type === "command" || cond.type === "pipeline"
      || cond.type === "list" || cond.type === "negated_command") {
      this.visit(cond, parentId);
      return;
    }
    this.walkSubstitutions(cond, parentId);
  }

  visitSource(n, parentId, args) {
    const target = args[0] ?? "";
    const id = this.makeId(parentId, `${this.safeName(target)}.import`);
    this.emit({ id, type: "import", parentId: parentId ?? null, ...this.pos(n), names: [target || "(unknown)"] }, parentId, n);
  }

  visitPipeline(n, parentId) {
    let prevId = null;
    for (const stage of n.namedChildren) {
      let stageId;
      if (stage.type === "command") {
        stageId = this.visitCommand(stage, parentId);
      } else if (stage.type === "redirected_statement") {
        const body = stage.childForFieldName("body") ?? stage.namedChildren[0];
        stageId = body && body.type === "command" ? this.visitCommand(body, parentId) : undefined;
      } else {
        // ANY OTHER STAGE SHAPE. tree-sitter nests a long pipeline as
        // `pipeline(command, list(pipeline(…)))`, and a stage may be a
        // subshell or a loop — `git ls-files | grep -v X | while read f;
        // do … done` is ordinary shell. Handling only plain commands
        // dropped the stage AND its whole body in silence: three-stage
        // pipelines lost two thirds, and that `while read` lost its
        // mkdir and its cp.
        this.visit(stage, parentId);
        // The chain is broken by something this IR does not model as one
        // node, so no data edge is drawn ACROSS it rather than a wrong
        // one being drawn past it.
        prevId = null;
        continue;
      }
      if (prevId && stageId) {
        this.edges.push({ source: prevId, target: stageId, type: "data" });
      }
      prevId = stageId ?? null;
    }
  }

  valueKindOf(valueNode) {
    if (!valueNode) return "other";
    switch (valueNode.type) {
      case "number": return "scalar";
      case "string": case "raw_string": case "ansi_c_string": return "string";
      case "command_substitution": return "call";
      case "array": return "list";
      case "word": return "scalar";
      case "simple_expansion": case "expansion": return "string";
      default: return "other";
    }
  }

  visitAssignment(n, parentId) {
    const nameNode = n.childForFieldName("name") ?? n.namedChildren.find((c) => c.type === "variable_name");
    const name = nameNode ? this.text(nameNode) : "_";
    const valueNode = n.childForFieldName("value")
      ?? n.namedChildren.find((c) => c.type !== "variable_name"
        && (!nameNode || c.id !== nameNode.id));
    const id = this.makeId(parentId, `${this.safeName(name)}.assign`);
    const node = {
      id, type: "assignment", parentId: parentId ?? null, ...this.pos(n),
      name,
      valueKind: this.valueKindOf(valueNode),
      preview: valueNode ? this.text(valueNode).slice(0, PREVIEW_MAX) : "",
    };
    if (node.valueKind === "list" && valueNode) {
      // `ALLOWED=( "a/x.sh" "b/y.sh" … )` — every element, the jsts list
      // rule (M-FLOW.5's reason: the 80-char preview cut the array off after
      // two paths, so a dispatcher's allow-list of 28 scripts read as 2 hops
      // — a private production codebase's job_orchestrator.sh, 2026-09-24).
      const els = valueNode.namedChildren.map((c) => this.text(c).slice(0, PREVIEW_MAX));
      if (els.length) node.args = els;
    }
    if (node.valueKind === "call" && valueNode) {
      // X=$(cmd …) — surface the substituted command as the callTarget.
      // firstCommandIn, not a direct child lookup: the body may be a
      // LIST (`$(a | b || true)`) or a REDIRECT (`$("$@" 2>&1)`), and
      // both used to fall through this branch AND the else, minting
      // nothing at all.
      const innerCmd = this.firstCommandIn(valueNode);
      const word = innerCmd ? this.commandWord(innerCmd) : null;
      if (word) {
        node.callTarget = word;
        // PARITY — the arguments the substituted command takes, like
        // Python's structured args on call-valued assignments.
        const innerArgs = this.commandArgs(innerCmd);
        if (innerArgs.length) node.args = innerArgs;
        const effect = effectKindForCommand(word);
        if (effect) node.effectKind = effect;
      }
    }
    this.emit(node, parentId, n);
    // `X=$(a $(b))` — substitutions nested INSIDE the substituted command
    // are this assignment's nests (the outer $() IS the callTarget).
    if (node.valueKind === "call" && valueNode) {
      const inner = this.firstCommandIn(valueNode);
      if (inner) {
        this.stampNests(inner, node, id);
        // `$(a | b)` / `$(a && b)` — every later command runs too.
        for (const sib of this.commandsAfter(valueNode, inner)) {
          this.emitCommandInSubstitution(sib, parentId, 0);
        }
      } else {
        this.walkSubstitutions(valueNode, parentId);
      }
    } else if (valueNode) {
      // `msg="text $(get_val)"`, `arr=( "$(cmd)" )`, `export E="$(cmd)"`
      // — the substitution runs whatever the value's shape is.
      this.walkSubstitutions(valueNode, parentId);
    }
  }

  visitIf(n, parentId) {
    const cond = n.namedChildren.find((c) => c.type === "test_command" || c.type === "command" || c.type === "list");
    const arms = n.namedChildren.filter((c) => c.type === "elif_clause" || c.type === "else_clause");
    const id = this.makeAnonId(parentId, "if");
    const node = {
      id, type: "if_stmt", parentId: parentId ?? null, ...this.pos(n),
      condition: cond ? this.text(cond) : "",
      hasElse: arms.length > 0,
    };
    if (arms.length > 0) node.elseLine = arms[0].startPosition.row + 1;
    // A substitution in the TEST runs once, in the enclosing flow,
    // whichever arm follows — `if [ -n "$(probe)" ]` really does run
    // `probe`, and it used to produce no node.
    if (cond) this.walkConditionCommands(cond, parentId);
    this.emit(node, parentId, n);
    for (const child of n.namedChildren) {
      if (cond && child.id === cond.id) continue; // id-compare: fresh wrappers per access
      if (child.type === "elif_clause") {
        // Mirrors Python's elif shape: a nested if_stmt inside the outer
        // if's else arm (its line ≥ elseLine, so the extractor buckets it
        // if_else; its own children parent to the nested node).
        this.visitElif(child, id, arms);
      } else if (child.type === "else_clause") {
        this.walkChildren(child, id);
      } else {
        this.visit(child, id);
      }
    }
  }

  visitElif(n, parentId, siblingArms) {
    const cond = n.namedChildren.find((c) => c.type === "test_command" || c.type === "command" || c.type === "list");
    const later = siblingArms.filter((a) => a.startIndex > n.startIndex);
    const id = this.makeAnonId(parentId, "if");
    const node = {
      id, type: "if_stmt", parentId, ...this.pos(n),
      condition: cond ? this.text(cond) : "",
      hasElse: later.length > 0,
    };
    if (later.length > 0) node.elseLine = later[0].startPosition.row + 1;
    this.emit(node, parentId, n);
    for (const child of n.namedChildren) {
      if (cond && child.id === cond.id) continue;
      this.visit(child, id);
    }
  }

  visitCase(n, parentId) {
    // NAMED LIMIT: case flattens to one if_stmt; every arm's statements
    // parent to it (no per-arm containers in v1).
    const subject = n.namedChildren.find((c) => c.type !== "case_item");
    const id = this.makeAnonId(parentId, "if");
    if (subject) this.walkSubstitutions(subject, parentId);
    this.emit({
      id, type: "if_stmt", parentId: parentId ?? null, ...this.pos(n),
      condition: subject ? `case ${this.text(subject)}` : "case",
      hasElse: false,
    }, parentId, n);
    for (const item of n.namedChildren) {
      if (item.type === "case_item") this.walkChildren(item, id);
    }
  }

  visitWhile(n, parentId) {
    const cond = n.childForFieldName("condition")
      ?? n.namedChildren.find((c) => c.type !== "do_group");
    const id = this.makeAnonId(parentId, "while");
    this.emit({
      id, type: "while_loop", parentId: parentId ?? null, ...this.pos(n),
      condition: cond ? this.text(cond) : "",
    }, parentId, n);
    // A while test is re-evaluated EVERY iteration, so a command in it
    // is a command run in the loop: it parents INSIDE.
    if (cond) this.walkConditionCommands(cond, id);
    const body = n.namedChildren.find((c) => c.type === "do_group");
    if (body) this.walkChildren(body, id);
  }

  visitFor(n, parentId) {
    const varNode = n.childForFieldName("variable") ?? n.namedChildren.find((c) => c.type === "variable_name");
    // Compare by node id, never object identity: web-tree-sitter mints a
    // FRESH wrapper per access, so `c !== varNode` was always true and the
    // loop variable leaked into iterName ("for target in target staging…").
    const valueNodes = n.namedChildren.filter(
      (c) => c.type !== "do_group" && c.type !== "variable_name"
        && (!varNode || c.id !== varNode.id),
    );
    const id = this.makeAnonId(parentId, "for");
    // `for f in $(git ls-files)` — the list is produced ONCE, before the
    // loop, so its command parents outside and is emitted ahead of it.
    for (const v of valueNodes) this.walkSubstitutions(v, parentId);
    this.emit({
      id, type: "for_loop", parentId: parentId ?? null, ...this.pos(n),
      target: varNode ? this.text(varNode) : "_",
      iterName: valueNodes.map((c) => this.text(c)).join(" "),
    }, parentId, n);
    const body = n.namedChildren.find((c) => c.type === "do_group");
    if (body) this.walkChildren(body, id);
  }

  // Same-file references: a call whose word names a function defined in
  // this file. (Cross-file resolution through `source` is link_bash.mjs's.)
  resolveLocalReferences() {
    for (const { id, funcName } of this.callSites) {
      const fnId = this.functionIds.get(funcName);
      if (fnId) this.edges.push({ source: id, target: fnId, type: "reference" });
    }
  }
}

/** Parse source text → { builder, ir, dropped }. Pure (no fs). */
export async function buildFromSource(source, moduleId) {
  const p = await getParser();
  const tree = p.parse(source);
  const b = new BashGraphBuilder(source);
  b.visit(tree.rootNode, null);
  b.resolveLocalReferences();
  const ir = {
    version: "2.0",
    language: "bash",
    nodes: b.nodes,
    edges: b.edges,
    symbolIndex: b.symbolIndex,
  };
  if (moduleId) ir.modulePath = moduleId;
  // Additive root field (ir.schema.json root allows extra properties):
  // discover_bash.mjs keys the cli-entry rule on it — the IR is the
  // only thing discovery sees, and node lists don't carry the shebang.
  if (source.startsWith("#!")) ir.shebang = source.slice(0, source.indexOf("\n"));
  return { builder: b, ir, dropped: b.dropped };
}

export async function parseFile(filePath, moduleId) {
  const source = readFileSync(filePath, "utf-8");
  const { ir, dropped } = await buildFromSource(source, moduleId);
  return { ir, dropped };
}

/** True when the parsed tree of `source` contains any ERROR/MISSING. */
export async function sourceHasParseErrors(source) {
  const p = await getParser();
  const tree = p.parse(source);
  const s = tree.rootNode.toString();
  return s.includes("(ERROR") || s.includes("(MISSING") || tree.rootNode.hasError;
}
