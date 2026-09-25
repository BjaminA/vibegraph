// M-LANG5b (PLAN-M-LANG.md) — the JS/TS IR builder, extracted from
// parse_jsts.mjs so the rewriter resolves structural IDs from the SAME
// code that mints them (the parse_cst↔cst_rewrite pattern, same as
// bash/builder.mjs). Records BYTE SPANS per emitted node (`spans`:
// id → {start, end}) for the rewriter's splice; the IR boundary drops
// them. Mapping decisions + named limits documented in parse_jsts.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Parser, Language } from "web-tree-sitter";
import { effectKindForCallee } from "./tables.mjs";
import { docFromComments } from "../doc_comments.mjs";
import { hasNestedCall, directCallArgs } from "../nests.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// TWO dialects, and the file's extension picks one. tree-sitter ships
// them apart because they genuinely conflict: in .ts `<T>x` is a type
// assertion, in .tsx it opens a JSX element, and no single grammar can
// read both. `.tsx` was registered by M-LANG3 while only the .ts dialect
// was committed, so every JSX file parsed mostly as ERROR nodes and the
// drop counter silently absorbed it.
const GRAMMARS = {
  ts: join(HERE, "..", "grammars", "tree-sitter-typescript.wasm"),
  tsx: join(HERE, "..", "grammars", "tree-sitter-tsx.wasm"),
};
const PREVIEW_MAX = 80;
// M-CONTRACT.1 — nest machinery: `new X(...)` counts as a call (its
// constructor is a resolvable callee), matching valueKindOf.
const CALL_TYPES = new Set(["call_expression", "new_expression"]);

// M-FLOW.3 — a handler REGISTERED UNDER A NAME. `server.registerTool("x", …,
// handler)` (the MCP SDK; `.tool(` is its older spelling, `.addTool(` a
// common wrapper) names a function the protocol dispatches to by that
// string — the callee side of a `tool` crossing and an entry point in its
// own right, so the inline handler is minted as function_def `x` rather than
// flattened into the registering function like any other inline callback.
const TOOL_REGISTRATION = /(^|\.)(registerTool|tool|addTool)$/;
export function mcpToolName(callee, args) {
  if (!TOOL_REGISTRATION.test(callee)) return null;
  const a0 = Array.isArray(args) ? args[0] : undefined;
  const m = typeof a0 === "string" ? /^\s*(["'`])([A-Za-z0-9_.:\-]+)\1\s*$/.exec(a0) : null;
  return m ? m[2] : null;
}
/** The node types `visit` knows how to walk as STATEMENTS. Anything
 *  else reached in statement position is an expression, and its calls
 *  still run — `export default defineConfig({…})` used to lose the whole
 *  call because `visit` had no case for it and said nothing. */
const STATEMENT_TYPES = new Set([
  "program", "statement_block", "export_statement", "import_statement",
  "lexical_declaration", "variable_declaration", "function_declaration",
  "generator_function_declaration", "class_declaration", "interface_declaration",
  "expression_statement", "if_statement", "switch_statement",
  "for_statement", "for_in_statement", "while_statement", "do_statement",
  "try_statement", "return_statement", "throw_statement",
]);

/** Function EXPRESSIONS — a body here is its own evaluation frame. */
const FUNCTION_EXPR_TYPES = new Set([
  "arrow_function", "function_expression", "generator_function",
]);

const parsers = new Map();

/** `dialect` is "ts" or "tsx"; both are cached, so a mixed project pays
 *  for each grammar once. */
export async function getParser(dialect = "ts") {
  const key = dialect === "tsx" ? "tsx" : "ts";
  if (!parsers.has(key)) {
    await Parser.init();
    const lang = await Language.load(GRAMMARS[key]);
    const p = new Parser();
    p.setLanguage(lang);
    parsers.set(key, p);
  }
  return parsers.get(key);
}

/** The dialect a path is written in. Only `.tsx` carries JSX. */
export function dialectForPath(filePath) {
  return String(filePath ?? "").toLowerCase().endsWith(".tsx") ? "tsx" : "ts";
}

export class JstsGraphBuilder {
  constructor(source) {
    this.source = source;
    this.nodes = [];
    this.edges = [];
    this.symbolIndex = [];
    this.functionIds = new Map();
    this.callSites = [];
    this.counters = new Map();
    // M-LANG5b — byte spans per emitted node id (first emission wins,
    // matching ID-collision resolution; see vibegraph-ir).
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
    if (parentId) this.edges.push({ source: parentId, target: node.id, type: "contains" });
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

  safeName(name) {
    return name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "_";
  }

  preview(n) { return this.text(n).slice(0, PREVIEW_MAX); }

  /** M-ARCH.3 — the KEYS of every object literal passed as an argument,
   *  aligned with `args` ([] for a non-object argument); one level of
   *  nesting is kept as `outer.inner` (an MCP `callTool({ name, arguments:
   *  { region } })` says `arguments.region`). Keys, never values. Null when
   *  no argument is an object literal, so a node without one is unchanged. */
  argKeysOf(callNode) {
    const args = callNode.childForFieldName("arguments");
    if (!args) return null;
    const out = [];
    let any = false;
    for (const a of args.namedChildren) {
      if (a.type === "arrow_function" || a.type === "function_expression") continue;
      const keys = [];
      if (a.type === "object") {
        for (const p of a.namedChildren) {
          if (p.type === "shorthand_property_identifier") keys.push(this.text(p));
          else if (p.type === "pair") {
            const k = this.text(p.childForFieldName("key")).replace(/^["']|["']$/g, "");
            keys.push(k);
            const v = this.unwrap(p.childForFieldName("value"));
            if (v?.type === "object") {
              for (const q of v.namedChildren) {
                if (q.type === "shorthand_property_identifier") keys.push(`${k}.${this.text(q)}`);
                else if (q.type === "pair") keys.push(`${k}.${this.text(q.childForFieldName("key")).replace(/^["']|["']$/g, "")}`);
              }
            }
          } else if (p.type === "spread_element") keys.push(this.text(p).slice(0, 40));
        }
      }
      if (keys.length) any = true;
      out.push(keys.slice(0, 16));
    }
    return any ? out : null;
  }

  /** M-FLOW.5 — the string literals inside an expression, in source order,
   *  quotes stripped, capped at 8 × 200 chars. Stops at a nested function:
   *  its literals belong to its own evaluation. */
  stringLiterals(n) {
    const out = [];
    const walk = (node) => {
      if (!node || out.length >= 8) return;
      if (FUNCTION_EXPR_TYPES.has(node.type)) return;
      if (node.type === "string" || node.type === "template_string") {
        out.push(this.text(node).replace(/^["'`]|["'`]$/g, "").slice(0, 200));
        return;
      }
      for (const c of node.namedChildren) walk(c);
    };
    walk(n);
    return out;
  }

  // Strip await/parens; returns the effective value expression node.
  unwrap(n) {
    let cur = n;
    while (cur && (cur.type === "await_expression" || cur.type === "parenthesized_expression")) {
      cur = cur.namedChildren[0] ?? null;
    }
    return cur;
  }

  calleeText(callNode) {
    const fn = callNode.childForFieldName("function") ?? callNode.namedChildren[0];
    return fn ? this.text(fn) : "<unknown>";
  }

  callArgs(callNode) {
    const args = callNode.childForFieldName("arguments");
    if (!args) return [];
    return args.namedChildren
      .filter((c) => c.type !== "arrow_function" && c.type !== "function_expression")
      .map((c) => this.text(c).slice(0, PREVIEW_MAX));
  }

  isAsyncNode(n) {
    for (let i = 0; i < n.childCount; i++) {
      if (n.child(i)?.type === "async") return true;
    }
    return false;
  }

  paramList(n) {
    const params = n.childForFieldName("parameters");
    if (!params) return [];
    return params.namedChildren.map((c) => this.text(c).slice(0, 40));
  }

  walkChildren(node, parentId) {
    for (const child of node.namedChildren) this.visit(child, parentId);
  }

  visit(n, parentId) {
    if (n.isMissing) { this.dropped += 1; return; }
    if (n.type === "ERROR") { this.dropped += 1; return this.walkChildren(n, parentId); }
    switch (n.type) {
      case "program": case "statement_block":
        return this.walkChildren(n, parentId);
      case "export_statement": {
        // `export default <expression>` — the exported thing may be a
        // CALL rather than a declaration, and a plain walkChildren left
        // it to `visit`, which has no case for an expression.
        // M-FLOW.5 — `export default X;` (a separate statement after the
        // definition, the other common spelling) names the file's default
        // export; the function it names is marked once the walk is done.
        const isDefault = n.children.some((c) => c.type === "default");
        for (const c of n.namedChildren) {
          if (STATEMENT_TYPES.has(c.type)) this.visit(c, parentId);
          else if (isDefault && c.type === "identifier" && !parentId) this.defaultExportName = this.text(c);
          else this.walkExpressionCalls(c, parentId);
        }
        return;
      }
      case "import_statement": return this.visitImport(n, parentId);
      case "lexical_declaration": case "variable_declaration":
        return this.visitDeclaration(n, parentId);
      case "function_declaration": case "generator_function_declaration":
        return this.visitFunction(n, parentId, null);
      case "class_declaration": return this.visitClass(n, parentId);
      case "interface_declaration": return this.visitInterface(n, parentId);
      case "expression_statement": return this.visitExpressionStatement(n, parentId);
      case "if_statement": return this.visitIf(n, parentId);
      case "switch_statement": return this.visitSwitch(n, parentId);
      case "for_statement": case "for_in_statement":
        return this.visitFor(n, parentId);
      case "while_statement": case "do_statement":
        return this.visitWhile(n, parentId);
      case "try_statement": return this.visitTry(n, parentId);
      case "return_statement": return this.visitReturn(n, parentId);
      case "throw_statement": return this.visitThrow(n, parentId);
      default:
        // Comments, labels, and the type declarations an interface is not
        // (`type X = …` — see visitInterface's note). Still no THREAD value:
        // nothing here is a call.
        return;
    }
  }

  visitImport(n, parentId) {
    const srcNode = n.childForFieldName("source") ?? n.namedChildren.find((c) => c.type === "string");
    const module = srcNode ? this.text(srcNode).replace(/^["']|["']$/g, "") : "";
    const names = [];
    const clause = n.namedChildren.find((c) => c.type === "import_clause");
    for (const c of clause?.namedChildren ?? []) {
      // M-FLOW.5 — a DEFAULT import spelled as `default as X`, the way a
      // namespace import is `* as X`: a bare `X` was indistinguishable from a
      // named `{ X }`, so the linker looked for a function NAMED X in the
      // target and `import Chart from "./RegionChart"` never bound to
      // `export default function RegionChartView`. Every reader of `names`
      // already splits on " as " (the linker, the stack's import bindings,
      // the extractor's import map).
      if (c.type === "identifier") names.push(`default as ${this.text(c)}`);
      else if (c.type === "namespace_import") {
        const id = c.namedChildren[0];
        if (id) names.push(`* as ${this.text(id)}`);
      } else if (c.type === "named_imports") {
        for (const spec of c.namedChildren) {
          if (spec.type !== "import_specifier") continue;
          const ids = spec.namedChildren.map((x) => this.text(x));
          names.push(ids.length === 2 ? `${ids[0]} as ${ids[1]}` : ids[0]);
        }
      }
    }
    const id = this.makeId(parentId, `${this.safeName(module)}.import_from`);
    this.emit({ id, type: "import_from", parentId: parentId ?? null, ...this.pos(n), module, names }, parentId, n);
  }

  visitDeclaration(n, parentId) {
    for (const decl of n.namedChildren) {
      if (decl.type !== "variable_declarator") continue;
      const nameNode = decl.childForFieldName("name") ?? decl.namedChildren[0];
      const name = nameNode ? this.text(nameNode) : "_";
      const value = this.unwrap(decl.childForFieldName("value"));
      if (value && (value.type === "arrow_function" || value.type === "function_expression"
        || value.type === "generator_function")) {
        this.visitFunction(value, parentId, name, n);
        continue;
      }
      if (value && value.type === "call_expression" && this.calleeText(value) === "require") {
        // const x = require("spec") — the CJS import form.
        const arg = value.childForFieldName("arguments")?.namedChildren[0];
        const module = arg ? this.text(arg).replace(/^["']|["']$/g, "") : "";
        const id = this.makeId(parentId, `${this.safeName(module)}.import_from`);
        this.emit({ id, type: "import_from", parentId: parentId ?? null, ...this.pos(n), module, names: [name] }, parentId, n);
        continue;
      }
      this.emitAssignment(n, parentId, name, value);
    }
  }

  emitAssignment(posNode, parentId, name, value, augmented) {
    const id = this.makeId(parentId, `${this.safeName(name)}.assign`);
    const node = {
      id, type: "assignment", parentId: parentId ?? null, ...this.pos(posNode),
      name,
      valueKind: this.valueKindOf(value),
      preview: value ? this.preview(value) : "",
      // M-CONTRACT.5 parity — `count += f()` REBINDS nothing; without
      // the operator every reader takes it for a binding of `count`.
      ...(augmented ? { augmented } : {}),
    };
    if (node.valueKind === "call" && value) {
      const callee = value.type === "new_expression"
        ? this.text(value.childForFieldName("constructor") ?? value.namedChildren[0])
        : this.calleeText(value);
      node.callTarget = callee;
      // PARITY — structured positional args on call-valued assignments
      // (Python's args field; kwargs have no JS analog).
      const callArgs = this.callArgs(value);
      if (callArgs.length) node.args = callArgs;
      const argKeys = this.argKeysOf(value);
      if (argKeys) node.argKeys = argKeys;
      const effect = effectKindForCallee(callee);
      if (effect) node.effectKind = effect;
      this.callSites.push({ id, callee });
      this.walkInlineCallbacks(value, parentId);
    } else if (value && value.type === "array") {
      // M-FLOW.2 — an ARRAY literal's elements, exactly as a call's args:
      // `const args = [ORCH, id, "accounts/get_accounts_financials.sh"]` is
      // how a real codebase names the script it is about to run, and the
      // 80-char preview cuts a long one off mid-path.
      const els = value.namedChildren.map((c) => this.text(c).slice(0, PREVIEW_MAX));
      if (els.length) node.args = els;
    } else if (value && (node.valueKind === "other" || node.valueKind === "dict" || node.valueKind === "fstring"
      || (node.valueKind === "string" && this.text(value).length > PREVIEW_MAX))) {
      // M-FLOW.5 — the STRING LITERALS inside a composite value. `const REL =
      // process.env.X ?? "accounts/get_accounts_financials.sh"` was the browser
      // → script hop a real codebase's own CLAUDE.md describes, and its
      // 80-char preview ended mid-path: the literal existed nowhere in the
      // IR. Recorded as data beside the preview, never as a call.
      const lits = this.stringLiterals(value);
      if (lits.length) node.literals = lits;
    }
    this.emit(node, parentId, posNode);
    if (node.valueKind === "call" && value) {
      this.stampNests(value, node, id);
    } else if (value) {
      // The value is a COMPOSITE — a ternary, an optional chain, a
      // template literal, an array or object literal, `a ?? b`. Its
      // calls still run, and used to produce no node at all.
      this.walkExpressionCalls(value, parentId);
    }
  }

  // M-CONTRACT.1 — M-NEST Layer 1 parity (parse_cst.py _stamp_nests):
  // detector flags the outer node, extraction mints one `nested` call
  // node per DIRECT call-valued argument (await/parens unwrapped),
  // recursively, parented at the outer node. Calls inside object
  // literals / binops / chains are detected-but-not-extracted.
  /**
   * The calls DIRECTLY under `callNode`: its call-valued arguments, and
   * the call at the head of its RECEIVER chain.
   *
   * `fetch(url).then(…)` and `(await res.text().catch(…)).slice(…)` put
   * the interesting call in the receiver, not an argument — chaining is
   * the JS idiom. Treating only arguments as direct (the rule inherited
   * from python, where chaining is rarer) left a network call merely
   * FLAGGED on a node labelled `.then`, which is true and useless. A
   * receiver is one hop through a member access, exactly as direct as an
   * argument; a call buried in a binop or a literal still is not, and
   * stays detected-but-not-extracted.
   */
  directCalls(callNode) {
    const out = [];
    const fn = callNode.childForFieldName("function");
    if (fn?.type === "member_expression" || fn?.type === "subscript_expression") {
      const recv = this.unwrap(fn.childForFieldName("object"));
      if (recv && CALL_TYPES.has(recv.type)) out.push(recv);
    }
    for (const a of directCallArgs(callNode, CALL_TYPES, (x) => this.unwrap(x))) out.push(a);
    return out;
  }

  stampNests(valueNode, node, outerId) {
    if (!valueNode || !hasNestedCall(valueNode, CALL_TYPES)) return;
    node.nestsInnerCalls = true;
    let minted = 0;
    if (CALL_TYPES.has(valueNode.type)) {
      for (const inner of this.directCalls(valueNode)) {
        minted += this.emitNestedCall(inner, outerId, 1);
      }
    }
    node.nestExtracted = minted > 0;
  }

  nestedCalleeText(callNode) {
    return callNode.type === "new_expression"
      ? this.text(callNode.childForFieldName("constructor") ?? callNode.namedChildren[0])
      : this.calleeText(callNode);
  }

  emitNestedCall(callNode, parentId, depth) {
    const callee = this.nestedCalleeText(callNode);
    const id = this.makeId(parentId, `${this.safeName(callee)}.call`);
    const node = {
      id, type: "call", parentId, ...this.pos(callNode),
      funcName: callee, args: this.callArgs(callNode), isEffect: false,
      callTarget: callee, preview: this.text(callNode).slice(0, PREVIEW_MAX),
      nested: true, nestedDepth: depth,
    };
    const effect = effectKindForCallee(callee);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId, callNode);
    if (!callee.includes(".") && callee !== "import") this.callSites.push({ id, callee });
    this.walkInlineCallbacks(callNode, parentId);
    let minted = 1;
    for (const inner of this.directCalls(callNode)) {
      minted += this.emitNestedCall(inner, id, depth + 1);
    }
    return minted;
  }

  valueKindOf(value) {
    if (!value) return "other";
    switch (value.type) {
      case "number": return "scalar";
      case "string": return "string";
      case "template_string": return "fstring";
      case "array": return "list";
      case "object": return "dict";
      case "call_expression": case "new_expression": return "call";
      case "true": case "false": case "null": case "undefined": return "scalar";
      default: return "other";
    }
  }

  visitFunction(n, parentId, nameOverride, posNode) {
    const nameNode = n.childForFieldName("name");
    const name = nameOverride ?? (nameNode ? this.text(nameNode) : "_anon");
    const id = this.makeId(parentId, `${this.safeName(name)}.fn`);
    // M-LANG5b — the rewrite SPAN must cover a wrapping export_statement
    // (splicing `export function …` over a span that starts at `function`
    // would double the keyword). IR positions are untouched: the span is
    // a builder-only, rewrite-time concern.
    const stmtNode = posNode ?? n;
    const spanNode = stmtNode.parent?.type === "export_statement" ? stmtNode.parent : stmtNode;
    const p = this.pos(stmtNode);
    // PARITY with the Python IR (fields already in the 2.0 schema):
    //  * docstring ← the JSDoc / comment block above the OUTERMOST
    //    statement (the export wrapper when one exists) — feeds thread
    //    step previews, launchpad summaries, explain/skills;
    //  * returns ← the literal TS return-type annotation, the exact
    //    analog of Python's `-> T` that §5.5 reads. Absent (null-free)
    //    when unannotated — absence stays honest.
    const docstring = docFromComments(spanNode, this.source);
    const retType = n.childForFieldName("return_type");
    const node = {
      id, type: "function_def", parentId: parentId ?? null, ...p,
      name, params: this.paramList(n), docstring,
      isAsync: this.isAsyncNode(n),
    };
    if (retType) node.returns = this.text(retType).replace(/^:\s*/, "");
    // M-CMD.1 — whether a function is EXPORTED, and whether it is the
    // default export. The IR had no way to say either, so a rule that keys
    // on "an exported function named for an HTTP verb" (Next.js App Router
    // handlers, 35 of them sitting unclassified on a real codebase) had
    // nothing to read. `spanNode` is already the export wrapper when one
    // exists — M-LANG5b computed it for the rewrite span — so this is that
    // same fact, kept instead of discarded.
    if (spanNode !== stmtNode && spanNode.type === "export_statement") {
      node.isExported = true;
      if (spanNode.children.some((c) => c.type === "default")) node.isDefaultExport = true;
    }
    this.emit(node, parentId, spanNode);
    if (!parentId) this.functionIds.set(name, id);
    this.symbolIndex.push({
      sym: `function:${name}`,
      kind: parentId?.endsWith(".class") ? "method" : "function",
      name,
      scope: parentId ?? "module",
      loc: { line: p.line, endLine: p.endLine, col: p.col, endCol: p.endCol },
      signature: `${this.isAsyncNode(n) ? "async " : ""}${name}(${this.paramList(n).join(", ")})`,
      docstring,
      // stmtNode, not spanNode: the M-LANG3 snapshot's symbol source
      // excludes a wrapping export keyword — only the SPAN grew.
      source: this.text(stmtNode),
    });
    // A DEFAULT PARAMETER is evaluated on every call, in this
    // function's own frame — so its calls parent to the function, not to
    // the caller. `function f(retries = defaultRetries())` used to lose
    // that call entirely.
    const params = n.childForFieldName("parameters");
    for (const prm of params?.namedChildren ?? []) {
      const dflt = prm.childForFieldName("value");
      if (dflt) {
        this.walkExpressionCalls(dflt, id);
        // M-FLOW.5 — a default value naming a script is a script the
        // function runs by default (`paramList` cuts each param at 40 chars).
        const lits = this.stringLiterals(dflt);
        if (lits.length) node.literals = [...(node.literals ?? []), ...lits].slice(0, 8);
      }
    }
    const body = n.childForFieldName("body");
    // A CONCISE arrow body (`() => fetchRows()`) is an expression, not a
    // statement_block, so `visit` fell through its default case and the
    // body was never walked. walkFunctionBody knows both shapes.
    if (body) {
      if (body.type === "statement_block") this.visit(body, id);
      else this.walkExpressionCalls(body, id);
    }
  }

  /**
   * A TypeScript `interface` declaration.
   *
   * The v1 rule was "type decls have no thread value", which is TRUE and was
   * the wrong test. A node is also the ADDRESS an edit is sent to: the
   * chokepoint targets IR ids, so a construct with no node cannot be
   * changed at all. M-SKILLS.3 measured the cost — a work-run packet
   * escalated with "gateway/api_client.ts is inside my remit but the
   * interface declaration is unreachable through the CST edit", failed, and
   * cost its arm the task — and `src/` alone holds 374 interfaces that were
   * equally unreachable.
   *
   * It stays out of threads by construction: the extractor selects
   * `function_def` / `class_def` and walks calls, and an interface has
   * none.
   *
   * TYPE ALIASES (`type X = …`) fail the same way and are NOT emitted here:
   * 100 of them in `src/`, none in any example or fixture, and none in the
   * measured failure. They are the named next step, not a guess bundled
   * into this one.
   */
  visitInterface(n, parentId) {
    const nameNode = n.childForFieldName("name") ?? n.namedChildren.find((c) => c.type === "type_identifier");
    const name = nameNode ? this.text(nameNode) : "_";
    const id = this.makeId(parentId, `${this.safeName(name)}.interface`);
    // M-LANG5b's rule, applied here: the rewrite span covers a wrapping
    // export_statement, so `replace_node` on `export interface X` splices
    // the whole statement rather than doubling the keyword.
    const spanNode = n.parent?.type === "export_statement" ? n.parent : n;
    const p = this.pos(n);
    const docstring = docFromComments(spanNode, this.source);
    const node = { id, type: "interface_def", parentId: parentId ?? null, ...p, name, docstring };
    // M-CMD.1 parity: whether the type is part of the module's public API.
    if (spanNode !== n && spanNode.type === "export_statement") {
      node.isExported = true;
      if (spanNode.children.some((c) => c.type === "default")) node.isDefaultExport = true;
    }
    this.emit(node, parentId, spanNode);
    this.symbolIndex.push({
      sym: `interface:${name}`, kind: "interface", name, scope: parentId ?? "module",
      loc: { line: p.line, endLine: p.endLine, col: p.col, endCol: p.endCol },
      signature: `interface ${name}`, docstring, source: this.text(n),
    });
  }

  visitClass(n, parentId) {
    const nameNode = n.childForFieldName("name") ?? n.namedChildren.find((c) => c.type === "type_identifier");
    const name = nameNode ? this.text(nameNode) : "_";
    const bases = [];
    const heritage = n.namedChildren.find((c) => c.type === "class_heritage");
    for (const ext of heritage?.namedChildren ?? []) {
      for (const b of ext.namedChildren) bases.push(this.text(b));
    }
    const id = this.makeId(parentId, `${this.safeName(name)}.class`);
    const p = this.pos(n);
    const anchor = n.parent?.type === "export_statement" ? n.parent : n;
    const docstring = docFromComments(anchor, this.source);
    this.emit({ id, type: "class_def", parentId: parentId ?? null, ...p, name, bases, docstring }, parentId, n);
    this.symbolIndex.push({
      sym: `class:${name}`, kind: "class", name, scope: parentId ?? "module",
      loc: { line: p.line, endLine: p.endLine, col: p.col, endCol: p.endCol },
      signature: `class ${name}`, docstring, bases, source: this.text(n),
    });
    const body = n.namedChildren.find((c) => c.type === "class_body");
    for (const m of body?.namedChildren ?? []) {
      if (m.type === "method_definition") {
        const mName = m.childForFieldName("name");
        this.visitFunction(m, id, mName ? this.text(mName) : "_method");
        continue;
      }
      // A FIELD INITIALISER runs when the class is constructed. A field
      // bound to a function is a method in everything but spelling
      // (`handle = async (req) => {…}`, the class-property idiom), so it
      // becomes one; anything else contributes the calls it evaluates.
      if (m.type !== "public_field_definition" && m.type !== "field_definition") continue;
      const fName = m.childForFieldName("name");
      const fValue = this.unwrap(m.childForFieldName("value"));
      if (fValue && FUNCTION_EXPR_TYPES.has(fValue.type)) {
        this.visitFunction(fValue, id, fName ? this.text(fName) : "_field", m);
      } else if (fValue) {
        this.walkExpressionCalls(fValue, id);
      }
    }
  }

  visitExpressionStatement(n, parentId) {
    const expr = this.unwrap(n.namedChildren[0]);
    if (!expr) return;
    if (CALL_TYPES.has(expr.type)) return this.visitCall(expr, parentId, n);
    if (expr.type === "assignment_expression"
      || expr.type === "augmented_assignment_expression") {
      const left = expr.childForFieldName("left");
      const right = this.unwrap(expr.childForFieldName("right"));
      const name = left ? this.text(left) : "_";
      // `obj.handler = () => {…}` binds a FUNCTION to a name, exactly as
      // `const handler = () => {…}` does, and visitDeclaration already
      // treats that as a definition. Reading it as a plain assignment
      // meant the body was never walked — the shape behind every
      // `transport.onclose = …` and `child.on("close", …)` handler.
      if (right && FUNCTION_EXPR_TYPES.has(right.type)) {
        return this.visitFunction(right, parentId, name, n);
      }
      const op = expr.type === "augmented_assignment_expression"
        ? expr.childForFieldName("operator")
        : null;
      // The TARGET can contain a call too: `byName.get(k)!.field = v`
      // performs the lookup before it assigns anything.
      if (left) this.walkExpressionCalls(left, parentId);
      return this.emitAssignment(n, parentId, name, right,
        op ? this.text(op) : undefined);
    }
    // Anything else that is still an EXPRESSION runs: `a && f()`,
    // `cond ? f() : g()`, `await f()`, a bare template literal.
    return this.walkExpressionCalls(expr, parentId);
  }

  visitCall(callNode, parentId, posNode) {
    const callee = this.calleeText(callNode);
    const id = this.makeId(parentId, `${this.safeName(callee)}.call`);
    const node = {
      id, type: "call", parentId: parentId ?? null, ...this.pos(posNode ?? callNode),
      funcName: callee, args: this.callArgs(callNode), isEffect: false,
    };
    const argKeys = this.argKeysOf(callNode);
    if (argKeys) node.argKeys = argKeys;
    const effect = effectKindForCallee(callee);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId, posNode ?? callNode);
    if (!callee.includes(".") && callee !== "import") this.callSites.push({ id, callee });
    this.stampNests(callNode, node, id);
    // NAMED LIMIT: inline arrow/function callbacks flatten into the
    // enclosing scope; identifier callbacks are resolvable data instead.
    // M-FLOW.3 — except a handler registered under a name (see mcpToolName).
    const toolName = mcpToolName(callee, node.args);
    if (toolName) node.mcpTool = toolName;
    this.walkInlineCallbacks(callNode, parentId, toolName);
    return id;
  }

  walkInlineCallbacks(callNode, parentId, toolName = null) {
    const args = callNode.childForFieldName("arguments");
    for (const a of args?.namedChildren ?? []) {
      if (!FUNCTION_EXPR_TYPES.has(a.type)) continue;
      if (toolName) {
        // The registered handler becomes a function node named for the tool.
        this.visitFunction(a, parentId, toolName, a);
        const fn = [...this.nodes].reverse().find((n) => n.type === "function_def" && n.name === toolName && (n.parentId ?? null) === (parentId ?? null));
        if (fn) fn.mcpTool = toolName;
        continue;
      }
      this.walkFunctionBody(a, parentId);
    }
    // An IIFE — `(async () => { … })()` — puts the function in the
    // CALLEE position, so an arguments-only sweep never saw the body
    // that IS the call.
    const callee = this.unwrap(callNode.childForFieldName("function"));
    if (callee && FUNCTION_EXPR_TYPES.has(callee.type)) {
      this.walkFunctionBody(callee, parentId);
    }
  }

  /**
   * Every call written INSIDE a composite expression, minted where it is
   * EVALUATED.
   *
   * M-SWEEP, JS/TS spelling. The builder used to emit a call node only
   * when the call was the DIRECT value of a statement, so a call in a
   * condition, a ternary, an iterable, a template literal or an optional
   * chain produced NO NODE — measured at 258 calls into functions this
   * project defines, each a thread step the source writes and the thread
   * did not walk (reviews/ir-fidelity/REVIEW.md). It is ONE bug, not
   * twenty: patching positions one at a time is what kept the same class
   * alive in python through `with`, then `if`/`while`.
   *
   * Stops at the OUTERMOST call — that call owns its own arguments
   * through stampNests, which keeps the M-CONTRACT.1 nest shape intact.
   * Stops at a FUNCTION BODY too: those calls run when the function is
   * called, not here, so walkFunctionBody parents them deliberately
   * rather than this walk hoisting them into the wrong frame.
   */
  walkExpressionCalls(node, parentId) {
    if (!node) return;
    // An OBJECT-literal method (`{ preconditions(facts) { … } }`) is a
    // DEFINITION: the registry-object idiom names real functions, and
    // only a function_def can be a thread seed or a link target.
    if (node.type === "method_definition") {
      const mName = node.childForFieldName("name");
      return this.visitFunction(node, parentId, mName ? this.text(mName) : "_method");
    }
    // A function EXPRESSION bound to nothing nameable flattens into the
    // enclosing scope (the stated inline-callback limit).
    if (FUNCTION_EXPR_TYPES.has(node.type)) {
      return this.walkFunctionBody(node, parentId);
    }
    // M-FLOW.1 — RENDERING IS CALLING. `<OrdersChart rows={rows} />`
    // evaluates the component function with those props, and a page's
    // thread that stopped at the page never reached the component tree
    // below it — where, on a real codebase, the platform client is used.
    if (node.type === "jsx_element" || node.type === "jsx_self_closing_element") {
      return this.visitJsx(node, parentId);
    }
    // `{ handler: () => { … } }` — a property bound to a function IS
    // named, so it is a definition like `const handler = () => {…}`.
    if (node.type === "pair") {
      const key = node.childForFieldName("key");
      const val = this.unwrap(node.childForFieldName("value"));
      if (val && FUNCTION_EXPR_TYPES.has(val.type)) {
        return this.visitFunction(val, parentId, key ? this.text(key) : "_prop", node);
      }
    }
    if (CALL_TYPES.has(node.type)) { this.visitCall(node, parentId, node); return; }
    for (const c of node.namedChildren) this.walkExpressionCalls(c, parentId);
  }

  /**
   * M-FLOW.1 — a JSX element, minted where it is evaluated.
   *
   * A COMPONENT tag is one that can resolve to a function: a capitalised
   * identifier (`OrdersChart`) or a member whose last segment is
   * (`UI.Badge`). It becomes a `call` node — `funcName` the tag, `args` its
   * attributes, `jsx: true` so a reader knows the spelling — and a bare
   * tag joins `callSites`, so the linker resolves it through the file's
   * import bindings exactly as it resolves `chargeCard(...)`. An INTRINSIC
   * element (`div`, `main`) is the DOM, not a function: nothing is minted
   * for it. Either way the attribute values and the children are
   * evaluated in the ENCLOSING frame — `onPick={(r) => select(r)}`
   * flattens like any inline callback and `{rows.map(...)}` is a call in
   * its own right — so both are walked.
   */
  visitJsx(node, parentId) {
    const open = node.type === "jsx_element" ? node.childForFieldName("open_tag") : node;
    const nameNode = open?.childForFieldName("name");
    const tag = nameNode ? this.text(nameNode) : "";
    const last = tag.split(".").pop() ?? "";
    if (tag && /^[A-Z]/.test(last)) {
      const id = this.makeId(parentId, `${this.safeName(tag)}.call`);
      const args = (open?.namedChildren ?? [])
        .filter((c) => c.type === "jsx_attribute")
        .map((c) => this.text(c).slice(0, PREVIEW_MAX));
      const call = {
        id, type: "call", parentId: parentId ?? null, ...this.pos(node),
        funcName: tag, args, isEffect: false, jsx: true,
      };
      this.emit(call, parentId, node);
      if (!tag.includes(".")) this.callSites.push({ id, callee: tag });
    }
    for (const a of open?.namedChildren ?? []) {
      if (a.type !== "jsx_attribute") continue;
      for (const v of a.namedChildren) this.walkExpressionCalls(v, parentId);
    }
    if (node.type === "jsx_element") {
      for (const c of node.namedChildren) {
        if (c.type === "jsx_opening_element" || c.type === "jsx_closing_element") continue;
        this.walkExpressionCalls(c, parentId);
      }
    }
  }

  /**
   * An inline function's body, walked into `parentId`.
   *
   * NAMED LIMIT (unchanged): inline callbacks FLATTEN into the enclosing
   * scope rather than becoming their own function_def. What changed is
   * WHERE they are found — the builder used to walk them only when they
   * sat in a call's argument list, so `transport.onclose = () => {…}`
   * and every concise arrow body (`() => f()`) were never walked at all.
   * In Node that is where much of the logic lives.
   */
  walkFunctionBody(fnNode, parentId) {
    const body = fnNode.childForFieldName("body");
    if (!body) return;
    if (body.type === "statement_block") this.walkChildren(body, parentId);
    else this.walkExpressionCalls(body, parentId);
  }

  visitIf(n, parentId) {
    const cond = n.childForFieldName("condition");
    const alt = n.childForFieldName("alternative"); // else_clause
    const id = this.makeAnonId(parentId, "if");
    const node = {
      id, type: "if_stmt", parentId: parentId ?? null, ...this.pos(n),
      condition: cond ? this.text(cond).replace(/^\(|\)$/g, "") : "",
      hasElse: !!alt,
    };
    if (alt) node.elseLine = alt.startPosition.row + 1;
    // The test is evaluated ONCE, in the enclosing flow, whichever arm
    // runs — so its calls parent OUTSIDE the branch and are emitted
    // ahead of it. This is the condition-call hole the python floor
    // closed on 2026-09-10; a guard written `if (checkToken(req))` had
    // no node at all, so nothing downstream could see the guard.
    if (cond) this.walkExpressionCalls(cond, parentId);
    this.emit(node, parentId, n);
    const consequence = n.childForFieldName("consequence");
    if (consequence) this.visit(consequence, id);
    for (const c of alt?.namedChildren ?? []) {
      // else-if: the nested if parents to the outer if (line ≥ elseLine
      // buckets it if_else — the python elif shape).
      this.visit(c, id);
    }
  }

  visitSwitch(n, parentId) {
    // NAMED LIMIT: switch flattens to one if_stmt; case bodies parent to it.
    const cond = n.childForFieldName("value") ?? n.namedChildren.find((c) => c.type === "parenthesized_expression");
    const id = this.makeAnonId(parentId, "if");
    // The discriminant is evaluated once, before any case is chosen.
    if (cond) this.walkExpressionCalls(cond, parentId);
    this.emit({
      id, type: "if_stmt", parentId: parentId ?? null, ...this.pos(n),
      condition: `switch ${cond ? this.text(cond) : ""}`.trim(),
      hasElse: false,
    }, parentId, n);
    const body = n.namedChildren.find((c) => c.type === "switch_body");
    for (const item of body?.namedChildren ?? []) {
      this.walkChildren(item, id); // switch_case / switch_default
    }
  }

  visitFor(n, parentId) {
    const id = this.makeAnonId(parentId, "for");
    let target = "_", iterName = "", iterSep;
    if (n.type === "for_in_statement") {
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      target = left ? this.text(left) : "_";
      iterName = right ? this.text(right) : "";
      // tree-sitter calls BOTH `for…in` and `for…of` a for_in_statement,
      // and the two mean different things in JS: `in` walks keys, `of`
      // walks values. The label must not pick one for the other, so the
      // separator is read from the source rather than assumed.
      const kw = n.children.find((c) => !c.isNamed && (this.text(c) === "of" || this.text(c) === "in"));
      iterSep = kw ? this.text(kw) : "of";
    } else {
      // A classic `for (let i = 0; i < n; i++)` has NO iterable, and
      // splitting it into target/iterName made the label read
      // "for let i = 0 in i < n" — a separator between two halves of one
      // header. Same fix the C++ frontend already carries: the whole
      // header goes in `target`, `iterName` stays empty, and the
      // extractor's no-iterName branch renders it as written.
      const init = n.childForFieldName("initializer");
      const cond = n.childForFieldName("condition");
      const update = n.childForFieldName("increment") ?? n.childForFieldName("update");
      target = [init, cond, update]
        .filter(Boolean)
        .map((c) => this.text(c).replace(/;$/, ""))
        .join("; ")
        .slice(0, 60) || "_";
      iterName = "";
    }
    // The ITERABLE is evaluated ONCE, before the loop, so its calls
    // parent outside it and are emitted ahead of it. A classic header
    // splits: the initialiser runs once (outside), the test and the
    // update run every iteration (inside, after the container exists).
    const iterableNode = n.type === "for_in_statement"
      ? n.childForFieldName("right")
      : n.childForFieldName("initializer");
    if (iterableNode) this.walkExpressionCalls(iterableNode, parentId);
    this.emit({
      id, type: "for_loop", parentId: parentId ?? null, ...this.pos(n), target, iterName,
      ...(iterSep ? { iterSep } : {}),
    }, parentId, n);
    if (n.type !== "for_in_statement") {
      for (const field of ["condition", "increment", "update"]) {
        const part = n.childForFieldName(field);
        if (part) this.walkExpressionCalls(part, id);
      }
    }
    const body = n.childForFieldName("body");
    if (body) this.visit(body, id);
  }

  visitWhile(n, parentId) {
    const cond = n.childForFieldName("condition");
    const id = this.makeAnonId(parentId, "while");
    this.emit({
      id, type: "while_loop", parentId: parentId ?? null, ...this.pos(n),
      condition: cond ? this.text(cond).replace(/^\(|\)$/g, "") : "",
    }, parentId, n);
    // A while test is re-evaluated EVERY iteration, so a call in it is a
    // call in the loop: it parents INSIDE. (An if test does not — hence
    // the two rules, which is the parse_cst.py shape.)
    if (cond) this.walkExpressionCalls(cond, id);
    const body = n.childForFieldName("body");
    if (body) this.visit(body, id);
  }

  visitTry(n, parentId) {
    // python v1.5 shape: except/finally are SIBLINGS of the try (same
    // scope), children parent into each arm.
    const id = this.makeAnonId(parentId, "try");
    this.emit({ id, type: "try_stmt", parentId: parentId ?? null, ...this.pos(n) }, parentId, n);
    const body = n.childForFieldName("body");
    if (body) this.walkChildren(body, id);
    const handler = n.childForFieldName("handler");
    if (handler) {
      const hid = this.makeAnonId(parentId, "except");
      const param = handler.childForFieldName("parameter");
      this.emit({
        id: hid, type: "except_handler", parentId: parentId ?? null, ...this.pos(handler),
        exceptType: param ? this.text(param) : null,
      }, parentId, handler);
      const hbody = handler.childForFieldName("body");
      if (hbody) this.walkChildren(hbody, hid);
    }
    const finalizer = n.childForFieldName("finalizer");
    if (finalizer) {
      const fid = this.makeAnonId(parentId, "finally");
      this.emit({ id: fid, type: "finally_block", parentId: parentId ?? null, ...this.pos(finalizer) }, parentId, finalizer);
      const fbody = finalizer.namedChildren.find((c) => c.type === "statement_block");
      if (fbody) this.walkChildren(fbody, fid);
    }
  }

  visitReturn(n, parentId) {
    const value = this.unwrap(n.namedChildren[0]);
    const id = this.makeAnonId(parentId, "return");
    const node = {
      id, type: "return_stmt", parentId: parentId ?? null, ...this.pos(n),
      value: value ? this.preview(value) : null,
    };
    if (value && (value.type === "call_expression" || value.type === "new_expression")) {
      const callee = value.type === "new_expression"
        ? this.text(value.childForFieldName("constructor") ?? value.namedChildren[0])
        : this.calleeText(value);
      node.callTarget = callee;
      // M-FLOW.2 — the arguments ride the return too: `return client.command(
      // "bash", ["orders/export.sh", id])` names the script it runs, and the
      // return node is the only node that call has.
      const callArgs = this.callArgs(value);
      if (callArgs.length) node.args = callArgs;
      const argKeys = this.argKeysOf(value);
      if (argKeys) node.argKeys = argKeys;
      const effect = effectKindForCallee(callee);
      if (effect) node.effectKind = effect;
      this.callSites.push({ id, callee });
    }
    this.emit(node, parentId, n);
    if (value && CALL_TYPES.has(value.type)) {
      this.stampNests(value, node, id);
      // `return new Promise((resolve) => { … })` — the executor is the
      // whole body of the function in practice, and it used to be walked
      // by nobody.
      this.walkInlineCallbacks(value, parentId);
    } else if (value) {
      this.walkExpressionCalls(value, parentId);
    }
  }

  visitThrow(n, parentId) {
    const value = this.unwrap(n.namedChildren[0]);
    const id = this.makeAnonId(parentId, "raise");
    const node = {
      id, type: "raise_stmt", parentId: parentId ?? null, ...this.pos(n),
      exc: value ? this.preview(value) : null,
    };
    if (value && (value.type === "call_expression" || value.type === "new_expression")) {
      const callee = value.type === "new_expression"
        ? this.text(value.childForFieldName("constructor") ?? value.namedChildren[0])
        : this.calleeText(value);
      node.callTarget = callee;
      this.callSites.push({ id, callee });
    }
    this.emit(node, parentId, n);
    // The thrown value runs before the throw does: `throw new Error(
    // `… ${await res.text()}`)` really does make that call.
    if (value && CALL_TYPES.has(value.type)) {
      this.stampNests(value, node, id);
      this.walkInlineCallbacks(value, parentId);
    } else if (value) {
      this.walkExpressionCalls(value, parentId);
    }
  }

  // Same-file references for bare callees naming a top-level function.
  resolveLocalReferences() {
    for (const { id, callee } of this.callSites) {
      if (callee.includes(".")) continue;
      const fnId = this.functionIds.get(callee);
      if (fnId) this.edges.push({ source: id, target: fnId, type: "reference" });
    }
  }
}

/** Parse source text → { builder, ir, dropped }. Pure (no fs). */
export async function buildFromSource(source, moduleId, dialect = "ts") {
  const p = await getParser(dialect);
  const tree = p.parse(source);
  const b = new JstsGraphBuilder(source);
  b.visit(tree.rootNode, null);
  b.resolveLocalReferences();
  if (b.defaultExportName) {
    const fn = b.nodes.find((n) => n.type === "function_def" && n.name === b.defaultExportName && (n.parentId ?? null) === null);
    if (fn) { fn.isExported = true; fn.isDefaultExport = true; }
  }
  const ir = {
    version: "2.0",
    language: "jsts",
    nodes: b.nodes,
    edges: b.edges,
    symbolIndex: b.symbolIndex,
  };
  if (moduleId) ir.modulePath = moduleId;
  // M-FLOW.1 — a `#!` first line marks the file as a SCRIPT, which is the
  // evidence discover_jsts seeds on (the bash builder stamps the same).
  if (source.startsWith("#!")) {
    const nl = source.indexOf("\n");
    ir.shebang = (nl === -1 ? source : source.slice(0, nl)).trim();
  }
  return { builder: b, ir, dropped: b.dropped };
}

export async function parseFile(filePath, moduleId) {
  const source = readFileSync(filePath, "utf-8");
  const { ir, dropped } = await buildFromSource(source, moduleId, dialectForPath(filePath));
  return { ir, dropped };
}

/** True when the parsed tree of `source` contains any ERROR/MISSING. */
export async function sourceHasParseErrors(source, dialect = "ts") {
  const p = await getParser(dialect);
  const tree = p.parse(source);
  const s = tree.rootNode.toString();
  return s.includes("(ERROR") || s.includes("(MISSING") || tree.rootNode.hasError;
}
