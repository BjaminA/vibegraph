#!/usr/bin/env node
// M-LANG5a (PLAN-M-LANG.md) — the C++ language frontend. Emits VibeGraph
// IR 2.0 ({version, language:"cpp", nodes, edges, symbolIndex,
// modulePath?}) for one C/C++ source file, speaking parse_cst.py's
// exact CLI contract (single + --batch). NO compile_commands.json in
// v1 — every file parses independently (tree-sitter-cpp WASM, pinned).
//
// Construct mapping (kind-shorts mirror parse_cst.py's _make_id grammar):
//   #include "x.h"                     → import (names: ["x.h"])
//   #include <vector>                  → import (names: ["<vector>"] —
//                                        brackets kept so the linker
//                                        skips system includes)
//   declaration with init              → assignment (constructor call
//                                        Circle c(2.0) → valueKind call,
//                                        callTarget "Circle")
//   function_definition                → function_def; an out-of-class
//                                        `Circle::area()` keeps the
//                                        QUALIFIED name (NAMED LIMIT:
//                                        not unified with the class
//                                        declared in the header)
//   template_declaration               → unwrapped to its inner
//                                        definition (plain fn/class)
//   class/struct_specifier             → class_def; in-class method
//                                        definitions nest as
//                                        module/C.class/m.fn
//   namespace_definition               → flattened (NAMED LIMIT)
//   statement-level call               → call (funcName keeps ::, .,
//                                        ->, and <T> — the extractor's
//                                        honesty rules key off them)
//   if/else (else-if nests) / switch   → if_stmt (switch flattened)
//   for / for_range_loop               → for_loop; while/do → while_loop
//   try / catch                        → try_stmt + SIBLING
//                                        except_handler (C++ has no
//                                        finally)
//   return / throw                     → return_stmt / raise_stmt
//
// OVERLOAD HONESTY (the C++ headline rule): a bare callee gets a
// same-file reference edge ONLY when exactly one definition of that
// name exists in the file — two or more means the target is
// overload-resolved by the compiler, and guessing would lie; the call
// classifies `unresolved` downstream (a resolution gap, honestly).
// Template calls keep their <T> and classify `dynamic`.
//
// ERROR/MISSING handling: same drop+recover floor as the bash frontend.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Parser, Language } from "web-tree-sitter";
import { effectKindForCallee } from "./tables.mjs";
import { docFromComments } from "../doc_comments.mjs";
import { hasNestedCall, directCallArgs } from "../nests.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR = join(HERE, "..", "grammars", "tree-sitter-cpp.wasm");
const PREVIEW_MAX = 80;
// M-CONTRACT.1 — the nest machinery keys on call_expression only: a
// `new` expression's callee is a type, not a resolvable call site here.
const CALL_TYPES = new Set(["call_expression"]);

let parser = null;
async function getParser() {
  if (!parser) {
    await Parser.init();
    const lang = await Language.load(GRAMMAR);
    parser = new Parser();
    parser.setLanguage(lang);
  }
  return parser;
}

/** One word per operator symbol, so `operator+=` and `operator==` mint
 *  DIFFERENT node ids. Node ids are structural paths a human reads and a
 *  rewriter resolves; `Router_operator.fn@1` is neither. */
const OPERATOR_WORD = {
  "+": "plus", "-": "minus", "*": "star", "/": "slash", "%": "mod",
  "=": "eq", "<": "lt", ">": "gt", "!": "not", "&": "and", "|": "or",
  "^": "xor", "~": "compl", "[": "idx", "]": "", "(": "call", ")": "",
  ",": "comma", ".": "dot", "-=": "minuseq",
};

class CppGraphBuilder {
  constructor(source) {
    this.source = source;
    /** 2026-09-25 (the edit floor) — IR node id → its byte span, for the
     *  rewriter's splice. Recorded from the SAME tree-sitter node pos() read,
     *  keyed by position, so no call site changes and no IR field is added. */
    this.spans = new Map();
    this.posIndex = new Map();
    this.nodes = [];
    this.edges = [];
    this.symbolIndex = [];
    /** Namespace names this file OPENS. Namespaces flatten (they mint no
     *  node), but the linker needs to know which leading qualifier on a
     *  call site it may drop — see the namespace_definition case. */
    this.namespaces = new Set();
    this.fnDefCounts = new Map(); // top-level name → definition count (overload honesty)
    this.functionIds = new Map(); // name → FIRST def's node id
    this.callSites = [];
    this.counters = new Map();
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

  emit(node, parentId) {
    const span = this.posIndex.get(`${node.line}:${node.col}:${node.endLine}:${node.endCol}`);
    if (span) this.spans.set(node.id, span);
    this.nodes.push(node);
    if (parentId) this.edges.push({ source: parentId, target: node.id, type: "contains" });
  }

  pos(n) {
    const p = {
      line: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
      col: n.startPosition.column,
      endCol: n.endPosition.column,
    };
    this.posIndex.set(`${p.line}:${p.col}:${p.endLine}:${p.endCol}`, { start: n.startIndex, end: n.endIndex });
    return p;
  }

  safeName(name) {
    // An OPERATOR keeps which operator it is. `operator+=` and
    // `operator==` on one class both collapsed to `..._operator`, so the
    // ids differed only by the `@1` the de-duplicator appends — two real
    // overloads distinguished by an arbitrary ordinal, which no reader
    // can map back to the source. Transliterate the symbols instead.
    const spelled = name.replace(/\boperator\s*([^\w\s(]+)/g, (_, ops) =>
      `operator_${[...ops].map((c) => OPERATOR_WORD[c] ?? "op").join("")}`);
    return spelled.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "_";
  }

  preview(n) { return this.text(n).slice(0, PREVIEW_MAX); }

  walkChildren(node, parentId) {
    for (const child of node.namedChildren) this.visit(child, parentId);
  }

  visit(n, parentId) {
    if (n.isMissing) { this.dropped += 1; return; }
    if (n.type === "ERROR") { this.dropped += 1; return this.walkChildren(n, parentId); }
    switch (n.type) {
      case "namespace_definition": {
        // NAMED LIMIT: namespaces still FLATTEN — they mint no node and
        // nothing nests inside them. But the NAME is recorded, because
        // dropping it silently cost every namespaced project all of its
        // cross-file resolution: definitions were indexed unqualified
        // (`verdict_name`) while every call site kept its qualifier
        // (`net::verdict_name`), and the linker skipped anything with a
        // `:` in it. The linker may now drop a leading qualifier ONLY
        // when this list says it names a namespace of this project, so
        // an unknown `other::parse` is still refused rather than guessed
        // onto a same-named function.
        const nameNode = n.childForFieldName("name");
        if (nameNode) for (const seg of this.text(nameNode).split("::")) {
          if (seg.trim()) this.namespaces.add(seg.trim());
        }
        return this.walkChildren(n, parentId);
      }
      case "translation_unit": case "compound_statement": case "declaration_list":
      case "linkage_specification": case "preproc_ifdef": case "preproc_if":
        return this.walkChildren(n, parentId);
      case "preproc_include": return this.visitInclude(n, parentId);
      case "declaration": return this.visitDeclaration(n, parentId);
      case "function_definition": return this.visitFunction(n, parentId);
      case "template_declaration": {
        const inner = n.namedChildren.find(
          (c) => c.type === "function_definition" || c.type === "class_specifier" || c.type === "struct_specifier",
        );
        return inner ? this.visit(inner, parentId) : undefined;
      }
      case "class_specifier": case "struct_specifier":
        return this.visitClass(n, parentId);
      case "expression_statement": return this.visitExpressionStatement(n, parentId);
      case "if_statement": return this.visitIf(n, parentId);
      case "switch_statement": return this.visitSwitch(n, parentId);
      case "for_statement": case "for_range_loop":
        return this.visitFor(n, parentId);
      case "while_statement": case "do_statement":
        return this.visitWhile(n, parentId);
      case "try_statement": return this.visitTry(n, parentId);
      case "return_statement": return this.visitReturn(n, parentId);
      case "throw_statement": return this.visitThrow(n, parentId);
      default:
        return; // typedefs, using-decls, field decls, comments — no thread value in v1
    }
  }

  visitInclude(n, parentId) {
    const quoted = n.namedChildren.find((c) => c.type === "string_literal");
    const system = n.namedChildren.find((c) => c.type === "system_lib_string");
    const name = quoted
      ? this.text(quoted).replace(/^"|"$/g, "")
      : system ? this.text(system) : "(unknown)";
    const id = this.makeId(parentId, `${this.safeName(name)}.import`);
    this.emit({ id, type: "import", parentId: parentId ?? null, ...this.pos(n), names: [name] }, parentId);
  }

  declaratorName(decl) {
    // function_declarator may nest under pointer/reference declarators.
    let cur = decl;
    while (cur && cur.type !== "function_declarator") {
      cur = cur.namedChildren.find((c) => c.type.endsWith("declarator"));
    }
    if (!cur) return null;
    const nameNode = cur.namedChildren.find((c) =>
      c.type === "identifier" || c.type === "qualified_identifier"
      || c.type === "field_identifier" || c.type === "destructor_name"
      || c.type === "operator_name");
    return { name: nameNode ? this.text(nameNode) : "_", declarator: cur };
  }

  paramList(fnDeclarator) {
    const params = fnDeclarator?.namedChildren.find((c) => c.type === "parameter_list");
    if (!params) return [];
    return params.namedChildren.map((c) => this.text(c).slice(0, 40));
  }

  visitFunction(n, parentId) {
    const declInfo = this.declaratorName(n);
    let name = declInfo?.name ?? "_";
    // gtest macros parse as functions literally named TEST/TEST_F —
    // useless as thread-seed labels and colliding as TEST.fn@k when a
    // file holds several. The macro's two args ARE the test's identity
    // in gtest's own model, so the function takes `Suite.Name` (a "."
    // never occurs in a real C++ function name, which is what
    // discover_cpp keys the test-entry rule on).
    const rawParams = this.paramList(declInfo?.declarator);
    if ((name === "TEST" || name === "TEST_F") && rawParams.length === 2
      && rawParams.every((p) => /^[A-Za-z_]\w*$/.test(p.trim()))) {
      name = `${rawParams[0].trim()}.${rawParams[1].trim()}`;
    }
    const id = this.makeId(parentId, `${this.safeName(name)}.fn`);
    const p = this.pos(n);
    // PARITY with the Python IR (fields already in the 2.0 schema):
    //  * docstring ← the comment block above the definition (climbing a
    //    template_declaration wrapper — the comment sits above
    //    `template<…>`, not the inner definition);
    //  * returns ← the declared return type, C++'s ALWAYS-literal
    //    analog of Python's `-> T` annotation.
    const anchor = n.parent?.type === "template_declaration" ? n.parent : n;
    const docstring = docFromComments(anchor, this.source);
    const typeNode = n.childForFieldName("type");
    const node = {
      id, type: "function_def", parentId: parentId ?? null, ...p,
      name, params: this.paramList(declInfo?.declarator), docstring,
    };
    if (typeNode) node.returns = this.text(typeNode);
    this.emit(node, parentId);
    if (parentId === null || parentId === undefined) {
      const count = (this.fnDefCounts.get(name) ?? 0) + 1;
      this.fnDefCounts.set(name, count);
      if (count === 1) this.functionIds.set(name, id);
    }
    this.symbolIndex.push({
      sym: `function:${name}`,
      kind: parentId?.endsWith(".class") ? "method" : "function",
      name,
      scope: parentId ?? "module",
      loc: { line: p.line, endLine: p.endLine, col: p.col, endCol: p.endCol },
      signature: `${typeNode ? this.text(typeNode) + " " : ""}${name}(${this.paramList(declInfo?.declarator).join(", ")})`,
      docstring,
      source: this.text(n),
    });
    const body = n.namedChildren.find((c) => c.type === "compound_statement");
    if (body) this.walkChildren(body, id);
  }

  visitClass(n, parentId) {
    const nameNode = n.childForFieldName("name") ?? n.namedChildren.find((c) => c.type === "type_identifier");
    if (!nameNode) return; // anonymous / forward declarations carry no thread value
    const name = this.text(nameNode);
    const bases = [];
    const baseClause = n.namedChildren.find((c) => c.type === "base_class_clause");
    for (const b of baseClause?.namedChildren ?? []) {
      if (b.type.includes("identifier")) bases.push(this.text(b));
    }
    const id = this.makeId(parentId, `${this.safeName(name)}.class`);
    const p = this.pos(n);
    const anchor = n.parent?.type === "template_declaration" ? n.parent : n;
    const docstring = docFromComments(anchor, this.source);
    this.emit({ id, type: "class_def", parentId: parentId ?? null, ...p, name, bases, docstring }, parentId);
    this.symbolIndex.push({
      sym: `class:${name}`, kind: "class", name, scope: parentId ?? "module",
      loc: { line: p.line, endLine: p.endLine, col: p.col, endCol: p.endCol },
      signature: `class ${name}`, docstring, bases, source: this.text(n),
    });
    const body = n.childForFieldName("body") ?? n.namedChildren.find((c) => c.type === "field_declaration_list");
    for (const m of body?.namedChildren ?? []) {
      if (m.type === "function_definition") this.visitFunction(m, id);
    }
  }

  calleeText(callNode) {
    const fn = callNode.childForFieldName("function") ?? callNode.namedChildren[0];
    return fn ? this.text(fn) : "<unknown>";
  }

  callArgs(callNode) {
    const args = callNode.childForFieldName("arguments");
    return (args?.namedChildren ?? []).map((c) => this.text(c).slice(0, PREVIEW_MAX));
  }

  isPlainCallable(name) {
    return !/[:.<>-]/.test(name); // bare identifier: no ::, ., ->, <T>
  }

  /**
   * Every call written INSIDE a composite expression, minted where it
   * is evaluated — the M-SWEEP walk, C++ spelling.
   *
   * The builder minted a call only when it was the direct value of a
   * statement, so `if (checksum(b, 25) != want)` and
   * `while (fread(frame, 1, n, cap) == n)` produced NO node: two FS
   * boundaries invisible to the effect floor and to attribution.
   *
   * Stops at the OUTERMOST call, which owns its own arguments through
   * stampNests, and at a LAMBDA body, whose calls run when it is called.
   */
  walkExpressionCalls(node, parentId) {
    if (!node) return;
    if (node.type === "lambda_expression") {
      const body = node.childForFieldName("body");
      if (body) this.walkChildren(body, parentId);
      return;
    }
    if (node.type === "call_expression") {
      if (!this.isCastExpression(node)) {
        this.mintCall(node, node, parentId);
        return;
      }
      // A cast mints nothing itself, but its OPERAND may still call.
      for (const c of node.namedChildren) this.walkExpressionCalls(c, parentId);
      return;
    }
    for (const c of node.namedChildren) this.walkExpressionCalls(c, parentId);
  }

  /** The value IS a call this IR should name — a cast is not one. */
  isRealCall(value) {
    return value?.type === "call_expression" && !this.isCastExpression(value);
  }

  /** `static_cast<T>(x)` and friends parse as a call and are a language
   *  OPERATOR — a conversion, calling into nothing. Minting one would
   *  put a step in every thread that names no function. */
  isCastExpression(callNode) {
    const fn = callNode.childForFieldName("function") ?? callNode.namedChildren[0];
    if (!fn) return false;
    return /^(static_cast|dynamic_cast|const_cast|reinterpret_cast)\b/
      .test(this.text(fn).trim());
  }

  /** Mint one call node. Shared by the statement path and the walk, so
   *  both produce the same shape. */
  mintCall(expr, posNode, parentId) {
    const callee = this.calleeText(expr);
    const id = this.makeId(parentId, `${this.safeName(callee)}.call`);
    const node = {
      id, type: "call", parentId: parentId ?? null, ...this.pos(posNode),
      funcName: callee, args: this.callArgs(expr), isEffect: false,
    };
    const effect = effectKindForCallee(callee);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId);
    this.registerCallSite(id, callee);
    this.stampNests(expr, node, id);
    return id;
  }

  registerCallSite(id, callee) {
    if (this.isPlainCallable(callee)) this.callSites.push({ id, callee });
  }

  // M-CONTRACT.1 — M-NEST Layer 1 parity (parse_cst.py _stamp_nests):
  // detector flags the outer node, extraction mints one `nested` call
  // node per DIRECT call-valued argument (recursively), parented at the
  // outer node so the contains edge reads outer→inner. Calls buried in
  // binops/literals are detected-but-not-extracted (nestExtracted false).
  stampNests(valueNode, node, outerId) {
    if (!hasNestedCall(valueNode, CALL_TYPES)) return;
    node.nestsInnerCalls = true;
    let minted = 0;
    if (valueNode.type === "call_expression") {
      for (const inner of directCallArgs(valueNode, CALL_TYPES)) {
        minted += this.emitNestedCall(inner, outerId, 1);
      }
    }
    node.nestExtracted = minted > 0;
  }

  emitNestedCall(callNode, parentId, depth) {
    const callee = this.calleeText(callNode);
    const id = this.makeId(parentId, `${this.safeName(callee)}.call`);
    const node = {
      id, type: "call", parentId, ...this.pos(callNode),
      funcName: callee, args: this.callArgs(callNode), isEffect: false,
      // callTarget mirrors funcName (python parity); the seam guard fields
      // mark this as a sub-node the default projection collapses.
      callTarget: callee, preview: this.text(callNode).slice(0, PREVIEW_MAX),
      nested: true, nestedDepth: depth,
    };
    const effect = effectKindForCallee(callee);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId);
    this.registerCallSite(id, callee); // overload honesty applies to nests too
    let minted = 1;
    for (const inner of directCallArgs(callNode, CALL_TYPES)) {
      minted += this.emitNestedCall(inner, id, depth + 1);
    }
    return minted;
  }

  visitDeclaration(n, parentId) {
    for (const decl of n.namedChildren) {
      if (decl.type !== "init_declarator") continue;
      // The name may nest under pointer/reference declarators
      // (`auto* f = …`): descend the declarator field to the identifier.
      let nameNode = decl.childForFieldName("declarator");
      while (nameNode && nameNode.type !== "identifier") {
        nameNode = nameNode.namedChildren.find(
          (c) => c.type === "identifier" || c.type.endsWith("declarator"),
        ) ?? null;
      }
      const name = nameNode ? this.text(nameNode) : "_";
      // id-compare, never object identity (web-tree-sitter mints fresh
      // wrappers per access).
      const value = decl.childForFieldName("value")
        ?? decl.namedChildren.find((c) => !c.type.endsWith("declarator")
          && (!nameNode || c.id !== nameNode.id));
      const id = this.makeId(parentId, `${this.safeName(name)}.assign`);
      const node = {
        id, type: "assignment", parentId: parentId ?? null, ...this.pos(n),
        name,
        valueKind: this.valueKindOf(value),
        preview: value ? this.preview(value) : "",
      };
      if (this.isRealCall(value)) {
        const callee = this.calleeText(value);
        node.callTarget = callee;
        // PARITY — structured positional args (Python's args field).
        const callArgs = this.callArgs(value);
        if (callArgs.length) node.args = callArgs;
        const effect = effectKindForCallee(callee);
        if (effect) node.effectKind = effect;
        this.registerCallSite(id, callee);
      } else if (value?.type === "argument_list") {
        // Circle c(2.0) — a constructor call in declarator syntax.
        const declType = n.namedChildren.find((c) => c.type === "type_identifier");
        if (declType) {
          node.valueKind = "call";
          node.callTarget = this.text(declType);
          const ctorArgs = value.namedChildren.map((c) => this.text(c).slice(0, PREVIEW_MAX));
          if (ctorArgs.length) node.args = ctorArgs;
        }
      }
      this.emit(node, parentId);
      if (this.isRealCall(value)) this.stampNests(value, node, id);
      else if (value && value.type !== "argument_list") {
        this.walkExpressionCalls(value, parentId);
      }
    }
  }

  valueKindOf(value) {
    if (!value) return "other";
    switch (value.type) {
      case "number_literal": return "scalar";
      case "string_literal": case "raw_string_literal": case "char_literal": return "string";
      case "call_expression": case "new_expression": return "call";
      case "initializer_list": return "list";
      case "true": case "false": case "nullptr": return "scalar";
      default: return "other";
    }
  }

  visitExpressionStatement(n, parentId) {
    const expr = n.namedChildren[0];
    if (!expr) return;
    if (this.isRealCall(expr)) {
      const callee = this.calleeText(expr);
      const id = this.makeId(parentId, `${this.safeName(callee)}.call`);
      const node = {
        id, type: "call", parentId: parentId ?? null, ...this.pos(n),
        funcName: callee, args: this.callArgs(expr), isEffect: false,
      };
      const effect = effectKindForCallee(callee);
      if (effect) { node.effectKind = effect; node.isEffect = true; }
      this.emit(node, parentId);
      this.registerCallSite(id, callee);
      this.stampNests(expr, node, id);
    } else if (expr.type === "assignment_expression") {
      const right = expr.childForFieldName("right");
      if (right?.type === "call_expression") {
        const left = expr.childForFieldName("left");
        const name = left ? this.text(left) : "_";
        const callee = this.calleeText(right);
        // AUGMENTED (`r += f()`) or plain (`r = f()`)? The operator was
        // never read, so `router += net::Router::parse(raw)` recorded
        // `router` as BOUND to that call — and the receiver tooltip then
        // stated, as fact, that `router` "is a local binding from
        // net::Router::parse()". It is default-constructed and never
        // reassigned. `augmented` is the field Python already stamps for
        // exactly this (M-CONTRACT.5); stack_attribution's local-binding
        // rule reads it and declines to treat a mutation as a binding.
        const op = expr.children.find((c) => !c.isNamed && c.type.endsWith("=") && c.type !== "=");
        const id = this.makeId(parentId, `${this.safeName(name)}.assign`);
        const node = {
          id, type: "assignment", parentId: parentId ?? null, ...this.pos(n),
          name, valueKind: "call", preview: this.preview(right), callTarget: callee,
          ...(op ? { augmented: op.type } : {}),
        };
        const effect = effectKindForCallee(callee);
        if (effect) node.effectKind = effect;
        this.emit(node, parentId);
        this.registerCallSite(id, callee);
        this.stampNests(right, node, id);
      }
    }
  }

  visitIf(n, parentId) {
    const cond = n.childForFieldName("condition") ?? n.namedChildren.find((c) => c.type === "condition_clause");
    const alt = n.childForFieldName("alternative"); // else_clause
    const id = this.makeAnonId(parentId, "if");
    const node = {
      id, type: "if_stmt", parentId: parentId ?? null, ...this.pos(n),
      condition: cond ? this.text(cond).replace(/^\(|\)$/g, "") : "",
      hasElse: !!alt,
    };
    if (alt) node.elseLine = alt.startPosition.row + 1;
    // The test is evaluated ONCE, in the enclosing flow, whichever arm
    // runs — so its calls parent OUTSIDE the branch, ahead of it.
    if (cond) this.walkExpressionCalls(cond, parentId);
    this.emit(node, parentId);
    const consequence = n.childForFieldName("consequence");
    if (consequence) this.visit(consequence, id);
    for (const c of alt?.namedChildren ?? []) this.visit(c, id); // else-if nests (python shape)
  }

  visitSwitch(n, parentId) {
    // NAMED LIMIT: switch flattens to one if_stmt.
    const cond = n.childForFieldName("condition") ?? n.namedChildren.find((c) => c.type === "condition_clause");
    const id = this.makeAnonId(parentId, "if");
    if (cond) this.walkExpressionCalls(cond, parentId);
    this.emit({
      id, type: "if_stmt", parentId: parentId ?? null, ...this.pos(n),
      condition: `switch ${cond ? this.text(cond) : ""}`.trim(),
      hasElse: false,
    }, parentId);
    const body = n.childForFieldName("body");
    for (const item of body?.namedChildren ?? []) {
      if (item.type === "case_statement") this.walkChildren(item, id);
    }
  }

  visitFor(n, parentId) {
    const id = this.makeAnonId(parentId, "for");
    let target = "_", iterName = "", iterSep;
    if (n.type === "for_range_loop") {
      // The declared TYPE is a sibling field, not part of the declarator:
      // `const std::string& raw` parses as type `const std::string` plus
      // declarator `& raw`. Taking the declarator alone rendered
      // "for & raw", which reads as nothing at all — the type is most of
      // what a reader needs from a range-for header.
      const decl = n.childForFieldName("declarator");
      const declType = n.childForFieldName("type");
      // `const` reaches the tree either as a bare token or as a named
      // `type_qualifier`, depending on where it sits; take both.
      const quals = n.children
        .filter((c) => c.type === "type_qualifier" || (!c.isNamed && /^(const|constexpr|volatile)$/.test(this.text(c))))
        .map((c) => this.text(c))
        .filter((t) => /^(const|constexpr|volatile)$/.test(t));
      const right = n.childForFieldName("right");
      const declText = decl ? this.text(decl) : "";
      target = [...quals, declType ? this.text(declType) : "", declText]
        .filter(Boolean).join(" ").replace(/\s+([&*])\s*/g, "$1 ").trim() || "_";
      iterName = right ? this.text(right) : "";
      iterSep = ":";
    } else {
      // Classic C for: the whole header goes in `target` and iterName
      // stays empty, so the container label reads
      // "for int i = 0; i < count" instead of the Python-shaped
      // "for <init> in <cond>" (extract_thread's no-iterName branch).
      const init = n.childForFieldName("initializer");
      const cond = n.childForFieldName("condition");
      const update = n.childForFieldName("update");
      target = [init, cond, update]
        .filter(Boolean)
        .map((c) => this.text(c).replace(/;$/, ""))
        .join("; ")
        .slice(0, 60) || "_";
      iterName = "";
    }
    // A range-for's RIGHT and a classic for's INITIALISER run once,
    // before the loop; the condition and the update run every iteration.
    const once = n.type === "for_range_loop"
      ? n.childForFieldName("right")
      : n.childForFieldName("initializer");
    if (once) this.walkExpressionCalls(once, parentId);
    this.emit({ id, type: "for_loop", parentId: parentId ?? null, ...this.pos(n), target, iterName, ...(iterSep ? { iterSep } : {}) }, parentId);
    if (n.type !== "for_range_loop") {
      for (const field of ["condition", "update"]) {
        const part = n.childForFieldName(field);
        if (part) this.walkExpressionCalls(part, id);
      }
    }
    const body = n.childForFieldName("body") ?? n.namedChildren.find((c) => c.type === "compound_statement");
    if (body) this.visit(body, id);
  }

  visitWhile(n, parentId) {
    const cond = n.childForFieldName("condition") ?? n.namedChildren.find((c) => c.type === "condition_clause");
    const id = this.makeAnonId(parentId, "while");
    this.emit({
      id, type: "while_loop", parentId: parentId ?? null, ...this.pos(n),
      condition: cond ? this.text(cond).replace(/^\(|\)$/g, "") : "",
    }, parentId);
    // A while test is re-evaluated EVERY iteration — `while (fread(…))`
    // reads the file once per pass — so it parents INSIDE the loop.
    if (cond) this.walkExpressionCalls(cond, id);
    const body = n.childForFieldName("body") ?? n.namedChildren.find((c) => c.type === "compound_statement");
    if (body) this.visit(body, id);
  }

  visitTry(n, parentId) {
    // python v1.5 sibling shape; C++ has no finally.
    const id = this.makeAnonId(parentId, "try");
    this.emit({ id, type: "try_stmt", parentId: parentId ?? null, ...this.pos(n) }, parentId);
    const body = n.childForFieldName("body") ?? n.namedChildren.find((c) => c.type === "compound_statement");
    if (body) this.walkChildren(body, id);
    for (const handler of n.namedChildren.filter((c) => c.type === "catch_clause")) {
      const hid = this.makeAnonId(parentId, "except");
      const param = handler.namedChildren.find((c) => c.type === "parameter_list");
      this.emit({
        id: hid, type: "except_handler", parentId: parentId ?? null, ...this.pos(handler),
        exceptType: param ? this.text(param).replace(/^\(|\)$/g, "") : null,
      }, parentId);
      const hbody = handler.namedChildren.find((c) => c.type === "compound_statement");
      if (hbody) this.walkChildren(hbody, hid);
    }
  }

  visitReturn(n, parentId) {
    const value = n.namedChildren[0];
    const id = this.makeAnonId(parentId, "return");
    const node = {
      id, type: "return_stmt", parentId: parentId ?? null, ...this.pos(n),
      value: value ? this.preview(value) : null,
    };
    if (this.isRealCall(value)) {
      const callee = this.calleeText(value);
      node.callTarget = callee;
      const effect = effectKindForCallee(callee);
      if (effect) node.effectKind = effect;
      this.registerCallSite(id, callee);
    }
    this.emit(node, parentId);
    if (this.isRealCall(value)) this.stampNests(value, node, id);
    else if (value) this.walkExpressionCalls(value, parentId);
  }

  visitThrow(n, parentId) {
    const value = n.namedChildren[0];
    const id = this.makeAnonId(parentId, "raise");
    const node = {
      id, type: "raise_stmt", parentId: parentId ?? null, ...this.pos(n),
      exc: value ? this.preview(value) : null,
    };
    if (this.isRealCall(value)) node.callTarget = this.calleeText(value);
    this.emit(node, parentId);
    if (this.isRealCall(value)) this.stampNests(value, node, id);
    else if (value) this.walkExpressionCalls(value, parentId);
  }

  // Same-file references — OVERLOAD HONESTY: link only when the name
  // has exactly ONE definition in this file; two or more means the
  // compiler picks and we must not guess.
  resolveLocalReferences() {
    for (const { id, callee } of this.callSites) {
      if (this.fnDefCounts.get(callee) === 1) {
        this.edges.push({ source: id, target: this.functionIds.get(callee), type: "reference" });
      }
    }
  }
}

/** Build the IR of `source` — shared by parseFile and the rewriter (the
 *  edit floor mints and resolves ids through this one path). */
export async function buildFromSource(source) {
  const p = await getParser();
  const tree = p.parse(source);
  const b = new CppGraphBuilder(source);
  b.visit(tree.rootNode, null);
  b.resolveLocalReferences();
  return { builder: b, tree };
}

/** True when the parsed tree of `source` contains any ERROR/MISSING. */
export async function sourceHasParseErrors(source) {
  const p = await getParser();
  const tree = p.parse(source);
  return tree.rootNode.hasError;
}

async function parseFile(filePath, moduleId) {
  const source = readFileSync(filePath, "utf-8");
  const { builder: b } = await buildFromSource(source);
  const ir = {
    version: "2.0",
    language: "cpp",
    nodes: b.nodes,
    edges: b.edges,
    symbolIndex: b.symbolIndex,
  };
  // Additive, only when the file opens one — a file with no namespace
  // stamps exactly what it stamped before, so no fixture drifts.
  if (b.namespaces.size) ir.namespaces = [...b.namespaces].sort();
  if (moduleId) ir.modulePath = moduleId;
  return { ir, dropped: b.dropped };
}

/** M-CMD.1 — what an incomplete parse stamps onto its own IR. */
export function degradedNote(dropped) {
  return {
    dropped,
    note: `the parser could not read ${dropped} construct(s) in this file and dropped them: `
      + "this IR is INCOMPLETE, and anything absent from it may still exist in the source",
  };
}

async function runBatch() {
  const files = {};
  const errors = {};
  const rl = createInterface({ input: process.stdin, terminal: false });
  const jobs = [];
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    const [p, moduleId] = t.split("\t");
    jobs.push([p, moduleId]);
  }
  for (const [p, moduleId] of jobs) {
    try {
      const { ir, dropped } = await parseFile(p, moduleId);
      // M-CMD.1 — the damage rides WITH the IR, not only in the batch's error
      // map. A consumer that opens one file's IR (a worker, a contract, the
      // knowledge export) could not otherwise tell an incomplete parse from a
      // complete one: the IR looked whole and the count lived somewhere else.
      // That is the .tsx disaster's other half — the grammar was fixed, the
      // silence was not (reviews/ir-fidelity/REVIEW.md, field review B11).
      if (dropped > 0) ir.degraded = degradedNote(dropped);
      files[p] = ir;
      if (dropped > 0) errors[p] = `dropped ${dropped} unparseable construct(s)`;
    } catch (e) {
      errors[p] = String(e?.message ?? e);
    }
  }
  process.stdout.write(JSON.stringify({ files, errors }));
}

const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url).split(/[\\/]/).pop() === process.argv[1].split(/[\\/]/).pop();
const argv = IS_MAIN ? process.argv.slice(2) : [];
if (!IS_MAIN) {
  // imported (the rewriter): no command line to run
} else if (argv[0] === "--batch") {
  await runBatch();
} else {
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) {
    process.stderr.write("usage: parse_cpp.mjs <file> [--module-path <id>] | --batch\n");
    process.exit(2);
  }
  const mpIdx = argv.indexOf("--module-path");
  const moduleId = mpIdx !== -1 ? argv[mpIdx + 1] : undefined;
  try {
    const { ir, dropped } = await parseFile(file, moduleId);
    if (dropped > 0) ir.degraded = degradedNote(dropped);
    if (dropped > 0) process.stderr.write(`parse_cpp: dropped ${dropped} unparseable construct(s) in ${file}\n`);
    process.stdout.write(JSON.stringify(ir, null, 2));
  } catch (e) {
    process.stderr.write(`parse_cpp: ${e?.message ?? e}\n`);
    process.exit(1);
  }
}
