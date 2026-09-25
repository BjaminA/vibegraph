#!/usr/bin/env node
// M-RUST (PLAN-M-RUST.md) — the Rust language frontend. Emits VibeGraph
// IR 2.0 ({version, language:"rust", nodes, edges, symbolIndex,
// modulePath?}) for one .rs file, speaking parse_cst.py's exact CLI
// contract (single + --batch). tree-sitter-rust WASM, pinned.
//
// Construct mapping (kind-shorts mirror parse_cst.py's _make_id grammar):
//   use a::b::c;                  → import_from (module "a::b", names ["c"])
//   use a::{b, c as d};           → import_from (module "a", names
//                                   ["b", "c as d"] — the jsts `as` shape)
//   mod store;                    → import (names ["store"]) — the linker
//                                   resolves the file by Cargo convention
//   mod tests { … }               → walked flat, name recorded in
//                                   ir.modules (NAMED LIMIT: inline
//                                   modules flatten, the cpp namespace
//                                   precedent)
//   fn f(..) -> R { … }           → function_def (params, returns,
//                                   isAsync, decorators from attributes)
//   struct/enum/trait S           → class_def
//   impl S / impl T for S         → methods nest as module/S.class/m.fn;
//                                   a trait impl adds T to S's `bases`
//   let x = f();                  → assignment (valueKind call)
//   x += f();                     → assignment (augmented "+=")
//   f(a); a.f(); A::f();          → call (funcName keeps :: . and ::<T>)
//   m!(…)                         → call (funcName "m!"), §5.3 flag
//   panic!/todo!/unimplemented!   → raise_stmt (a diverging call ends flow)
//   return e;  AND a TAIL expr    → return_stmt (§5.1 — the headline)
//   if / if let / else-if         → if_stmt; match → if_stmt (arms flat)
//   for / while / while let/ loop → for_loop / while_loop
//   e? / e.await                  → unwrapped to the operand
//
// THE THREE RUST HONESTY RULES (PLAN-M-RUST §5):
//  1. TAIL EXPRESSIONS ARE RETURNS. `fn f() -> u32 { g() }` returns g()'s
//     value with no keyword, and the grammar marks it: a STATEMENT is
//     wrapped in `expression_statement`, a tail is a bare expression
//     child of the block. A thread that dropped it would lose the one
//     call the function exists to make. A container tail (match/if) is
//     walked as a container, not minted as a return.
//  2. MACRO ARGUMENTS ARE TOKENS. `println!("{}", f(x))` parses as a
//     token_tree — `f(x)` is not an expression node and cannot be minted.
//     So the node is FLAGGED (nestsInnerCalls, nestExtracted false), the
//     M-CONTRACT.1 contract: never silently dropped.
//  3. METHOD CALLS ARE DYNAMIC; PATH CALLS RESOLVE. Rust has no
//     overloading, so `Type::f` names exactly one function and the linker
//     may take it. `x.f()` needs the receiver's type, which this frontend
//     does not infer — `dynamic`, never a guess (the C++ answer).
//
// ERROR/MISSING handling: same drop+recover floor as the other frontends.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { Parser, Language } from "web-tree-sitter";
import { effectKindForCallee, ALWAYS_DIVERGING } from "./tables.mjs";
import { docFromComments } from "../doc_comments.mjs";
import { hasNestedCall, directCallArgs } from "../nests.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAMMAR = join(HERE, "..", "grammars", "tree-sitter-rust.wasm");
const PREVIEW_MAX = 80;
const CALL_TYPES = new Set(["call_expression"]);
/** Rust's comment node types — the doc_comments helper defaults to the
 *  single `comment` type the other three grammars use. */
const RUST_COMMENTS = new Set(["line_comment", "block_comment"]);

/** Statement forms inside a block. Anything else as the LAST child is a
 *  tail expression (rule 1). */
const STATEMENT_TYPES = new Set([
  "expression_statement", "let_declaration", "empty_statement",
  "function_item", "struct_item", "enum_item", "trait_item", "impl_item",
  "mod_item", "use_declaration", "const_item", "static_item", "type_item",
  "macro_definition", "attribute_item", "inner_attribute_item",
  "line_comment", "block_comment", "union_item", "extern_crate_declaration",
]);

/** Container expressions: as a tail these are WALKED, not minted as a
 *  return — a `match` tail is control flow whose arms carry the values. */
const CONTAINER_EXPRS = new Set([
  "match_expression", "if_expression", "block", "unsafe_block",
  "loop_expression", "while_expression", "for_expression",
]);

// ── Cargo identity ───────────────────────────────────────────────────
//
// WHY THE PARSER READS THE MANIFEST. The linker is spawned with the
// SERVER's working directory (spawnDerived passes no cwd), so it cannot
// find the analyzed project's Cargo.toml; the parser is handed a real
// file path and can walk up for it exactly as cargo does. Doing it here
// puts the layout convention in ONE place and lets the linker work from
// facts rather than a guess about which crate a path names.
//
// No manifest found ⇒ `crateName` is ABSENT, and the linker says a
// `use <name>::…` could not be resolved rather than assuming it is ours.

const manifestCache = new Map();

/** Nearest Cargo.toml at or above `dir`, or null. */
function findManifest(dir) {
  let cur = resolve(dir);
  for (;;) {
    if (manifestCache.has(cur)) return manifestCache.get(cur);
    const candidate = join(cur, "Cargo.toml");
    if (existsSync(candidate)) {
      const found = { dir: cur, path: candidate };
      manifestCache.set(cur, found);
      return found;
    }
    const up = dirname(cur);
    if (up === cur) { manifestCache.set(cur, null); return null; }
    cur = up;
  }
}

/**
 * The crate name Cargo publishes for `[package] name`, with `-` collapsed
 * to `_` — the spelling that appears in `use router_demo::…` for a
 * package named `router-demo`. Line-oriented on purpose: a TOML parser is
 * a dependency for one key, and `[workspace]` members are a named limit.
 */
function crateNameFrom(manifestPath) {
  let inPackage = false;
  for (const raw of readFileSync(manifestPath, "utf-8").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    if (line.startsWith("[")) { inPackage = line === "[package]"; continue; }
    if (!inPackage) continue;
    const m = /^name\s*=\s*"([^"]+)"/.exec(line);
    if (m) return m[1].replace(/-/g, "_");
  }
  return null;
}

/**
 * Where a file sits in its crate's module tree, by Cargo convention:
 *   src/lib.rs · src/main.rs · src/bin/x.rs · tests/x.rs · examples/x.rs
 *     → "crate" (each is a crate ROOT in its own right)
 *   src/a/b.rs   → "crate::a::b"
 *   src/a/mod.rs → "crate::a"
 * Anything outside those roots gets null — honest about a layout this
 * convention does not describe.
 */
function cratePathFor(fileAbs, crateDir) {
  const rel = relative(crateDir, fileAbs).split(sep).join("/");
  if (rel.startsWith("..")) return null;
  const ROOTS = new Set(["src/lib.rs", "src/main.rs"]);
  if (ROOTS.has(rel)) return { path: "crate", isRoot: true };
  if (/^(tests|examples|benches)\/[^/]+\.rs$/.test(rel)) return { path: "crate", isRoot: true };
  if (/^src\/bin\/[^/]+\.rs$/.test(rel)) return { path: "crate", isRoot: true };
  if (!rel.startsWith("src/") || !rel.endsWith(".rs")) return null;
  const inner = rel.slice("src/".length, -".rs".length);
  const segs = inner.split("/").filter(Boolean);
  if (segs[segs.length - 1] === "mod") segs.pop();
  return { path: ["crate", ...segs].join("::"), isRoot: false };
}

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

class RustGraphBuilder {
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
    /** name → {id, count} for top-level fns; count keeps the C++ habit of
     *  refusing to link an ambiguous name even though Rust rarely makes
     *  one (a `#[cfg]` pair can). */
    this.fnDefCounts = new Map();
    this.functionIds = new Map();
    /** Type name → its class_def id, so `impl S` and `impl T for S` both
     *  hang their methods off ONE node rather than minting S.class@1. */
    this.typeIds = new Map();
    /** Inline `mod x { … }` names — recorded because they flatten. */
    this.modules = new Set();
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

  /** Node ids are structural paths a human reads and a rewriter resolves.
   *  `::` and the macro `!` become `_`; a turbofish collapses to its base
   *  name plus its type args, so `parse::<i64>` → `parse_i64`. */
  safeName(name) {
    return name
      .replace(/::<([^>]*)>/g, "_$1")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "_";
  }

  preview(n) { return this.text(n).slice(0, PREVIEW_MAX); }

  walkChildren(node, parentId) {
    for (const child of node.namedChildren) this.visit(child, parentId);
  }

  /** `e?`, `e.await`, `(e)`, `&e` — the wrappers that do not change WHICH
   *  call is being made. Unwrapping is what lets `fs::read(p)?` mint the
   *  same node `fs::read(p)` would. */
  unwrap(n) {
    let cur = n;
    while (cur && (cur.type === "try_expression" || cur.type === "await_expression"
      || cur.type === "parenthesized_expression" || cur.type === "reference_expression"
      || cur.type === "unary_expression")) {
      const inner = cur.namedChildren[0];
      if (!inner) break;
      cur = inner;
    }
    return cur;
  }

  // ── doc comments + attributes ──────────────────────────────────────

  /** The outermost node of an item's run: `/// doc` then `#[attr]` then
   *  `fn` means the doc block sits above the ATTRIBUTE, so the anchor for
   *  docFromComments is the first attribute, not the fn (the cpp
   *  template_declaration anchor rule). */
  anchorOf(n) {
    let anchor = n;
    let sib = n.previousNamedSibling;
    while (sib && sib.type === "attribute_item"
      && sib.endPosition.row === anchor.startPosition.row - 1) {
      anchor = sib;
      sib = sib.previousNamedSibling;
    }
    return anchor;
  }

  /** Attribute texts directly above `n` (`#[test]` → "test"). Python's
   *  `decorators` field, so discover reads them instead of re-parsing. */
  attributesOf(n) {
    const out = [];
    let anchor = n;
    let sib = n.previousNamedSibling;
    while (sib && sib.type === "attribute_item"
      && sib.endPosition.row === anchor.startPosition.row - 1) {
      const attr = sib.namedChildren.find((c) => c.type === "attribute");
      out.unshift(attr ? this.text(attr) : this.text(sib).replace(/^#\[|\]$/g, ""));
      anchor = sib;
      sib = sib.previousNamedSibling;
    }
    return out;
  }

  docFor(n) {
    return docFromComments(this.anchorOf(n), this.source, RUST_COMMENTS);
  }

  // ── dispatch ───────────────────────────────────────────────────────

  visit(n, parentId) {
    if (n.isMissing) { this.dropped += 1; return; }
    if (n.type === "ERROR") { this.dropped += 1; return this.walkChildren(n, parentId); }
    switch (n.type) {
      case "source_file":
        return this.visitBlock(n, parentId);
      case "block": case "unsafe_block":
        return this.visitBlock(n, parentId);
      case "declaration_list":
        return this.walkChildren(n, parentId);
      case "use_declaration": return this.visitUse(n, parentId);
      case "mod_item": return this.visitMod(n, parentId);
      case "function_item": return this.visitFunction(n, parentId);
      case "struct_item": case "enum_item": case "trait_item": case "union_item":
        return this.visitType(n, parentId);
      case "impl_item": return this.visitImpl(n, parentId);
      case "let_declaration": return this.visitLet(n, parentId);
      case "expression_statement": return this.visitExpressionStatement(n, parentId);
      case "if_expression": return this.visitIf(n, parentId);
      case "match_expression": return this.visitMatch(n, parentId);
      case "for_expression": return this.visitFor(n, parentId);
      case "while_expression": case "loop_expression":
        return this.visitWhile(n, parentId);
      case "return_expression": return this.visitReturn(n, parentId);
      // A bare expression reached through visit() (a tail, or a match
      // arm's value) — mint whatever call it carries.
      case "call_expression": case "macro_invocation": case "await_expression":
      case "try_expression":
        return this.visitBareExpression(n, parentId);
      default:
        return; // const/static/type items, comments, attributes — no thread value in v1
    }
  }

  /**
   * A block, and RULE 1: its last named child decides whether this
   * function has a tail expression. A statement is wrapped in
   * `expression_statement`; a tail is bare. A CONTAINER tail (match/if)
   * is walked as the container it is — its arms hold the values.
   */
  visitBlock(n, parentId) {
    const children = n.namedChildren;
    const last = children[children.length - 1];
    // An ERROR or MISSING node is NOT a tail expression. Reading one as
    // a tail minted a `return` out of unparseable text AND swallowed the
    // drop count, so a broken file reported itself clean — found by the
    // recovery test, which is what that test is for.
    const tail = last
      && last.type !== "ERROR" && !last.isMissing
      && !STATEMENT_TYPES.has(last.type) && !CONTAINER_EXPRS.has(last.type)
      ? last : null;
    for (const child of children) {
      if (tail && child.id === tail.id) continue;
      this.visit(child, parentId);
    }
    if (tail) this.visitTail(tail, parentId);
  }

  /** RULE 1 — a tail expression IS the return. */
  visitTail(n, parentId) {
    const id = this.makeAnonId(parentId, "return");
    const value = this.unwrap(n);
    const node = {
      id, type: "return_stmt", parentId: parentId ?? null, ...this.pos(n),
      value: this.preview(n),
      // The reader must be able to tell a written `return` from a tail:
      // both are the function's value, only one is in the source.
      tailExpression: true,
    };
    if (value?.type === "call_expression") {
      const callee = this.calleeText(value);
      node.callTarget = callee;
      const effect = effectKindForCallee(callee);
      if (effect) node.effectKind = effect;
      this.registerCallSite(id, callee);
    } else if (value?.type === "macro_invocation") {
      node.callTarget = this.macroName(value);
    }
    this.emit(node, parentId);
    if (value?.type === "macro_invocation") this.stampMacroNests(value, node);
    else this.stampNests(value, node, id);
    if (value?.type === "call_expression") this.walkClosureArgs(value, parentId);
  }

  // ── imports ────────────────────────────────────────────────────────

  /**
   * `use` in every shape the grammar produces. The MODULE is the path
   * prefix and the NAMES are what it binds, because that is what
   * stack_attribution's import-binding rule reads: `use std::fs` must
   * bind `fs ↦ std` for `fs::read_to_string` to attribute to std.
   */
  visitUse(n, parentId) {
    const arg = n.childForFieldName("argument");
    if (!arg) return;
    const { module, names } = this.decodeUse(arg);
    const label = names.length === 1 ? names[0] : (module || "use");
    const id = this.makeId(parentId, `${this.safeName(label)}.import_from`);
    this.emit({
      id, type: "import_from", parentId: parentId ?? null, ...this.pos(n),
      module, names,
    }, parentId);
  }

  decodeUse(arg) {
    switch (arg.type) {
      case "scoped_use_list": {
        const path = arg.childForFieldName("path");
        const list = arg.childForFieldName("list");
        const names = [];
        for (const item of list?.namedChildren ?? []) {
          if (item.type === "use_as_clause") {
            const p = item.childForFieldName("path");
            const alias = item.childForFieldName("alias");
            names.push(`${p ? this.text(p) : "?"} as ${alias ? this.text(alias) : "?"}`);
          } else if (item.type === "use_wildcard") {
            names.push("*");
          } else {
            names.push(this.text(item));
          }
        }
        return { module: path ? this.text(path) : "", names };
      }
      case "use_wildcard": {
        // `use a::b::*;` — the wildcard node holds the whole path.
        const whole = this.text(arg).replace(/::\*$/, "");
        return { module: whole, names: ["*"] };
      }
      case "use_as_clause": {
        const p = arg.childForFieldName("path");
        const alias = arg.childForFieldName("alias");
        const full = p ? this.text(p) : "";
        const segs = full.split("::");
        const leaf = segs.pop() ?? full;
        return {
          module: segs.join("::"),
          names: [`${leaf} as ${alias ? this.text(alias) : "?"}`],
        };
      }
      case "scoped_identifier": {
        const full = this.text(arg);
        const segs = full.split("::");
        const leaf = segs.pop() ?? full;
        return { module: segs.join("::"), names: [leaf] };
      }
      default:
        return { module: "", names: [this.text(arg)] };
    }
  }

  /**
   * `mod x;` is an import of a FILE (the linker resolves it by Cargo
   * convention). `mod x { … }` is an inline module: it flattens, and the
   * name is recorded — the cpp namespace precedent, where dropping the
   * name silently cost every namespaced project its resolution.
   */
  visitMod(n, parentId) {
    const nameNode = n.childForFieldName("name");
    const name = nameNode ? this.text(nameNode) : "_";
    const body = n.childForFieldName("body");
    if (!body) {
      const id = this.makeId(parentId, `${this.safeName(name)}.import`);
      this.emit({
        id, type: "import", parentId: parentId ?? null, ...this.pos(n), names: [name],
      }, parentId);
      return;
    }
    this.modules.add(name);
    this.walkChildren(body, parentId);
  }

  // ── definitions ────────────────────────────────────────────────────

  paramList(n) {
    const params = n.childForFieldName("parameters");
    if (!params) return [];
    return params.namedChildren.map((c) => this.text(c).slice(0, 40));
  }

  visitFunction(n, parentId, typeName = null) {
    const nameNode = n.childForFieldName("name");
    const name = nameNode ? this.text(nameNode) : "_";
    const id = this.makeId(parentId, `${this.safeName(name)}.fn`);
    const p = this.pos(n);
    const docstring = this.docFor(n);
    const attrs = this.attributesOf(n);
    const retType = n.childForFieldName("return_type");
    const modifiers = n.namedChildren.find((c) => c.type === "function_modifiers");
    const isAsync = modifiers ? /\basync\b/.test(this.text(modifiers)) : false;
    const params = this.paramList(n);
    const node = {
      id, type: "function_def", parentId: parentId ?? null, ...p,
      name, params, docstring, isAsync,
    };
    if (retType) node.returns = this.text(retType);
    if (attrs.length) {
      node.decorators = attrs;
      // M-CONTRACT.6 — a line-slicing reader must start at the attribute
      // or a whole-node edit silently drops it.
      node.decoratorLine = this.anchorOf(n).startPosition.row + 1;
    }
    this.emit(node, parentId);
    if (parentId === null || parentId === undefined) {
      const count = (this.fnDefCounts.get(name) ?? 0) + 1;
      this.fnDefCounts.set(name, count);
      if (count === 1) this.functionIds.set(name, id);
    }
    this.symbolIndex.push({
      sym: `function:${name}`,
      kind: typeName ? "method" : "function",
      name,
      scope: parentId ?? "module",
      loc: { line: p.line, endLine: p.endLine, col: p.col, endCol: p.endCol },
      signature: `${isAsync ? "async " : ""}fn ${name}(${params.join(", ")})${retType ? ` -> ${this.text(retType)}` : ""}`,
      docstring,
      source: this.text(n),
    });
    const body = n.childForFieldName("body");
    if (body) this.visitBlock(body, id);
  }

  /** struct / enum / trait / union → class_def. ONE node per type name in
   *  a file, so a later `impl` reuses it. */
  visitType(n, parentId) {
    const nameNode = n.childForFieldName("name");
    if (!nameNode) return;
    const name = this.text(nameNode);
    const id = this.makeId(parentId, `${this.safeName(name)}.class`);
    const p = this.pos(n);
    const docstring = this.docFor(n);
    const kind = n.type.replace(/_item$/, "");
    this.emit({
      id, type: "class_def", parentId: parentId ?? null, ...p,
      name, bases: [], docstring,
    }, parentId);
    this.typeIds.set(name, id);
    this.symbolIndex.push({
      sym: `class:${name}`, kind: "class", name, scope: parentId ?? "module",
      loc: { line: p.line, endLine: p.endLine, col: p.col, endCol: p.endCol },
      signature: `${kind} ${name}`, docstring, bases: [], source: this.text(n),
    });
    // A trait's DEFAULT methods have bodies and are real definitions; a
    // `function_signature_item` (no body) is a declaration and mints
    // nothing — there is no code to thread through.
    const body = n.childForFieldName("body");
    for (const m of body?.namedChildren ?? []) {
      if (m.type === "function_item") this.visitFunction(m, id, name);
    }
  }

  /**
   * `impl S { … }` and `impl T for S { … }`. Methods hang off S's
   * class_def; a trait impl records T in S's `bases`, which is what makes
   * "LogSink is a Sink" a fact in the IR rather than a reading of the
   * source.
   *
   * NAMED LIMIT: an impl for a type declared in ANOTHER file mints a
   * class_def here (the C++ out-of-class-definition precedent) — honest
   * about the file it is in, not unified across the crate.
   */
  visitImpl(n, parentId) {
    const typeNode = n.childForFieldName("type");
    const traitNode = n.childForFieldName("trait");
    if (!typeNode) return;
    const typeName = this.text(typeNode);
    let id = this.typeIds.get(typeName);
    if (!id) {
      id = this.makeId(parentId, `${this.safeName(typeName)}.class`);
      const p = this.pos(n);
      this.emit({
        id, type: "class_def", parentId: parentId ?? null, ...p,
        name: typeName, bases: [], docstring: this.docFor(n),
      }, parentId);
      this.typeIds.set(typeName, id);
      this.symbolIndex.push({
        sym: `class:${typeName}`, kind: "class", name: typeName, scope: parentId ?? "module",
        loc: { line: p.line, endLine: p.endLine, col: p.col, endCol: p.endCol },
        signature: `impl ${typeName}`, docstring: null, bases: [], source: this.text(n),
      });
    }
    if (traitNode) {
      const traitName = this.text(traitNode);
      const cls = this.nodes.find((x) => x.id === id);
      if (cls && !cls.bases.includes(traitName)) cls.bases.push(traitName);
      const sym = this.symbolIndex.find((s) => s.sym === `class:${typeName}`);
      if (sym && Array.isArray(sym.bases) && !sym.bases.includes(traitName)) sym.bases.push(traitName);
    }
    const body = n.childForFieldName("body");
    for (const m of body?.namedChildren ?? []) {
      if (m.type === "function_item") this.visitFunction(m, id, typeName);
    }
  }

  // ── calls ──────────────────────────────────────────────────────────

  /** The callee AS WRITTEN — `::`, `.`, and `::<T>` are all kept, because
   *  the extractor's honesty rules key off exactly those characters. */
  calleeText(callNode) {
    const fn = callNode.childForFieldName("function") ?? callNode.namedChildren[0];
    return fn ? this.text(fn) : "<unknown>";
  }

  macroName(n) {
    const m = n.childForFieldName("macro");
    return `${m ? this.text(m) : "macro"}!`;
  }

  callArgs(callNode) {
    const args = callNode.childForFieldName("arguments");
    return (args?.namedChildren ?? []).map((c) => this.text(c).slice(0, PREVIEW_MAX));
  }

  /** A bare identifier or a path — never a method or a turbofish. Rust
   *  has no overloading, so a path IS linkable, which is the one place
   *  this frontend resolves more than the C++ one. */
  isPlainCallable(name) {
    return !/[.<>]/.test(name) && !name.endsWith("!");
  }

  registerCallSite(id, callee) {
    if (this.isPlainCallable(callee)) this.callSites.push({ id, callee });
  }

  /**
   * The calls DIRECTLY under `callNode`: its call-valued arguments, and —
   * Rust-specific — the call at the head of its receiver chain.
   *
   * `fs::read_to_string(p).unwrap_or_default()` is the idiomatic spelling
   * of a file read, and the boundary is the RECEIVER, not an argument.
   * Treating only arguments as direct (the python/cpp rule, written for
   * languages where chaining is rarer) left the fs effect merely FLAGGED
   * on a node labelled `unwrap_or_default` — true, and useless: the
   * thread would not have named the file read that `Store::open` exists
   * to do. A receiver is one hop through a field access, exactly as
   * direct as an argument; a call buried in a literal or a binop still
   * is not, and stays detected-but-not-extracted.
   */
  directCalls(callNode) {
    const out = [];
    const fn = callNode.childForFieldName("function");
    if (fn?.type === "field_expression") {
      const recv = this.unwrap(fn.childForFieldName("value"));
      if (recv && CALL_TYPES.has(recv.type)) out.push(recv);
    }
    for (const a of directCallArgs(callNode, CALL_TYPES, (x) => this.unwrap(x))) out.push(a);
    return out;
  }

  /**
   * M-CONTRACT.1 parity — see parse_cpp.mjs's note.
   *
   * Called for EVERY value, not only a call: a struct literal
   * (`Router { sinks: HashMap::new(), .. }`) or a tuple hides calls too,
   * and the contract is that such a node is flagged even when nothing can
   * be minted from it.
   */
  stampNests(valueNode, node, outerId) {
    if (!valueNode || !hasNestedCall(valueNode, CALL_TYPES)) return;
    node.nestsInnerCalls = true;
    let minted = 0;
    if (valueNode.type === "call_expression") {
      for (const inner of this.directCalls(valueNode)) {
        minted += this.emitNestedCall(inner, outerId, 1);
      }
    }
    node.nestExtracted = minted > 0;
  }

  /**
   * RULE 2 — a macro's arguments are TOKENS, so a call inside one cannot
   * be minted. Scan the token tree for `ident(` and FLAG the node. This
   * is the M-CONTRACT.1 contract's other half: flagged, never dropped, so
   * the thread's "path shown incomplete" badge fires instead of the
   * reader believing the macro is a leaf.
   */
  stampMacroNests(macroNode, node) {
    const tree = macroNode.namedChildren.find((c) => c.type === "token_tree");
    if (!tree) return;
    if (this.tokenTreeHasCall(tree)) {
      node.nestsInnerCalls = true;
      node.nestExtracted = false; // tokens are not expressions — nothing to mint
    }
  }

  /** An identifier token immediately followed by `(` is a call written in
   *  token position. `println!("{}", f(x))` → true; `println!("x")` →
   *  false. Walks nested token trees. */
  tokenTreeHasCall(tree) {
    const kids = tree.children;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.type === "identifier") {
        const next = kids[i + 1];
        if (next && next.type === "token_tree" && next.startIndex === k.endIndex) return true;
      }
      if (k.type === "token_tree" && this.tokenTreeHasCall(k)) return true;
    }
    return false;
  }

  emitNestedCall(callNode, parentId, depth) {
    const callee = this.calleeText(callNode);
    const id = this.makeId(parentId, `${this.safeName(callee)}.call`);
    const node = {
      id, type: "call", parentId, ...this.pos(callNode),
      funcName: callee, args: this.callArgs(callNode), isEffect: false,
      callTarget: callee, preview: this.text(callNode).slice(0, PREVIEW_MAX),
      nested: true, nestedDepth: depth,
    };
    const effect = effectKindForCallee(callee);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId);
    this.registerCallSite(id, callee);
    this.walkClosureArgs(callNode, parentId);
    let minted = 1;
    for (const inner of this.directCalls(callNode)) {
      minted += this.emitNestedCall(inner, id, depth + 1);
    }
    return minted;
  }

  /** A call / macro reached as a bare expression (a match arm's value, a
   *  tail already handled elsewhere). */
  visitBareExpression(n, parentId) {
    const expr = this.unwrap(n);
    if (!expr) return;
    if (expr.type === "call_expression") return this.mintCall(expr, n, parentId);
    if (expr.type === "macro_invocation") return this.mintMacro(expr, n, parentId);
    if (expr.type !== n.type) return this.visit(expr, parentId);
  }

  mintCall(expr, stmtNode, parentId) {
    const callee = this.calleeText(expr);
    const id = this.makeId(parentId, `${this.safeName(callee)}.call`);
    const node = {
      id, type: "call", parentId: parentId ?? null, ...this.pos(stmtNode),
      funcName: callee, args: this.callArgs(expr), isEffect: false,
    };
    const effect = effectKindForCallee(callee);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId);
    this.registerCallSite(id, callee);
    this.stampNests(expr, node, id);
    this.walkClosureArgs(expr, parentId);
  }

  mintMacro(expr, stmtNode, parentId) {
    const name = this.macroName(expr);
    // A never-returning macro ends the flow, which is what raise renders.
    // `assert!` is NOT here: it diverges only on failure, and a test's
    // asserts are its body, not its exits.
    if (ALWAYS_DIVERGING.has(name)) {
      const id = this.makeAnonId(parentId, "raise");
      this.emit({
        id, type: "raise_stmt", parentId: parentId ?? null, ...this.pos(stmtNode),
        exc: this.preview(expr), callTarget: name,
      }, parentId);
      return;
    }
    const id = this.makeId(parentId, `${this.safeName(name)}.call`);
    const node = {
      id, type: "call", parentId: parentId ?? null, ...this.pos(stmtNode),
      funcName: name, args: [], isEffect: false,
      preview: this.preview(expr),
    };
    const effect = effectKindForCallee(name);
    if (effect) { node.effectKind = effect; node.isEffect = true; }
    this.emit(node, parentId);
    this.stampMacroNests(expr, node);
  }

  // ── statements ─────────────────────────────────────────────────────

  valueKindOf(value) {
    if (!value) return "other";
    switch (value.type) {
      case "integer_literal": case "float_literal": case "boolean_literal":
      case "char_literal": case "unit_expression":
        return "scalar";
      case "string_literal": case "raw_string_literal":
        return "string";
      case "array_expression": return "list";
      case "tuple_expression": return "tuple";
      case "call_expression": case "macro_invocation": case "struct_expression":
        return "call";
      case "closure_expression": return "other";
      default: return "other";
    }
  }

  visitLet(n, parentId) {
    const pattern = n.childForFieldName("pattern");
    const name = pattern ? this.text(pattern) : "_";
    const rawValue = n.childForFieldName("value");
    const value = this.unwrap(rawValue);
    const id = this.makeId(parentId, `${this.safeName(name)}.assign`);
    const node = {
      id, type: "assignment", parentId: parentId ?? null, ...this.pos(n),
      name,
      valueKind: this.valueKindOf(value),
      preview: rawValue ? this.preview(rawValue) : "",
    };
    const annotation = n.childForFieldName("type");
    if (annotation) node.annotation = this.text(annotation);
    if (value?.type === "call_expression") {
      const callee = this.calleeText(value);
      node.callTarget = callee;
      const callArgs = this.callArgs(value);
      if (callArgs.length) node.args = callArgs;
      const effect = effectKindForCallee(callee);
      if (effect) node.effectKind = effect;
      this.registerCallSite(id, callee);
    } else if (value?.type === "macro_invocation") {
      const mname = this.macroName(value);
      node.callTarget = mname;
      const effect = effectKindForCallee(mname);
      if (effect) node.effectKind = effect;
    }
    this.emit(node, parentId);
    if (value?.type === "macro_invocation") this.stampMacroNests(value, node);
    else this.stampNests(value, node, id);
    if (value?.type === "call_expression") this.walkClosureArgs(value, parentId);
    // `let m = match flag { … }` / `let x = if c { a } else { b }` — a
    // container used as a VALUE is still control flow. Rendering it as a
    // plain assignment hid the branch entirely; the container parents at
    // the enclosing scope, which is where it runs.
    if (value && CONTAINER_EXPRS.has(value.type)) this.visit(value, parentId);
    // A closure's BODY is real code that runs; walk it under the
    // enclosing function (the jsts inline-callback precedent).
    // NAMED LIMIT: whether the closure is ever CALLED is not tracked.
    if (value?.type === "closure_expression") this.walkClosure(value, parentId);
  }

  walkClosure(closure, parentId) {
    const body = closure.childForFieldName("body");
    if (!body) return;
    if (body.type === "block") this.visitBlock(body, parentId);
    else this.visitBareExpression(body, parentId);
  }

  /**
   * Closures passed AS ARGUMENTS — `.ok_or_else(|| unknown_sink(n))`,
   * `.map(|x| f(x))`. The jsts `walkInlineCallbacks` precedent: the body
   * is real code that really runs, so its calls are nodes, parented at
   * the enclosing scope. Without this the whole error path of an
   * idiomatic Rust function is merely FLAGGED, which is the difference
   * between "this thread calls unknown_sink" and "something happens here".
   *
   * NAMED LIMIT (§5.5): whether the closure is ever INVOKED is not
   * tracked — the same limit M-COMP states for generator expressions.
   */
  walkClosureArgs(callNode, parentId) {
    const args = callNode.childForFieldName("arguments");
    for (const a of args?.namedChildren ?? []) {
      if (a.type === "closure_expression") this.walkClosure(a, parentId);
    }
  }

  visitExpressionStatement(n, parentId) {
    const raw = n.namedChildren[0];
    if (!raw) return;
    const expr = this.unwrap(raw);
    if (!expr) return;
    switch (expr.type) {
      case "call_expression": return this.mintCall(expr, n, parentId);
      case "macro_invocation": return this.mintMacro(expr, n, parentId);
      case "assignment_expression": return this.visitAssignExpr(expr, n, parentId, null);
      case "compound_assignment_expr": {
        const op = expr.childForFieldName("operator");
        return this.visitAssignExpr(expr, n, parentId, op ? this.text(op) : "+=");
      }
      case "return_expression": return this.visitReturn(expr, parentId);
      case "if_expression": return this.visitIf(expr, parentId);
      case "match_expression": return this.visitMatch(expr, parentId);
      case "for_expression": return this.visitFor(expr, parentId);
      case "while_expression": case "loop_expression":
        return this.visitWhile(expr, parentId);
      case "block": case "unsafe_block":
        return this.visitBlock(expr, parentId);
      case "break_expression": case "continue_expression":
        return;
      default:
        return;
    }
  }

  /**
   * `x = f()` and `x += f()`. The AUGMENTED operator is recorded because
   * without it `self.count += 1` reads as a BINDING of `self.count`, and
   * three frontends shipped that bug (M-CONTRACT.5 / the C++ fix).
   */
  visitAssignExpr(expr, stmtNode, parentId, augmented) {
    const left = expr.childForFieldName("left");
    const rawRight = expr.childForFieldName("right");
    const right = this.unwrap(rawRight);
    const name = left ? this.text(left) : "_";
    const id = this.makeId(parentId, `${this.safeName(name)}.assign`);
    const node = {
      id, type: "assignment", parentId: parentId ?? null, ...this.pos(stmtNode),
      name,
      valueKind: this.valueKindOf(right),
      preview: rawRight ? this.preview(rawRight) : "",
      ...(augmented ? { augmented } : {}),
    };
    if (right?.type === "call_expression") {
      const callee = this.calleeText(right);
      node.callTarget = callee;
      const callArgs = this.callArgs(right);
      if (callArgs.length) node.args = callArgs;
      const effect = effectKindForCallee(callee);
      if (effect) node.effectKind = effect;
      this.registerCallSite(id, callee);
    } else if (right?.type === "macro_invocation") {
      node.callTarget = this.macroName(right);
    }
    this.emit(node, parentId);
    if (right?.type === "macro_invocation") this.stampMacroNests(right, node);
    else this.stampNests(right, node, id);
    if (right?.type === "call_expression") this.walkClosureArgs(right, parentId);
    if (right && CONTAINER_EXPRS.has(right.type)) this.visit(right, parentId);
  }

  /** `if c`, `if let P = e` — the condition is the SOURCE's own words, so
   *  `if let Some(x) = opt` reads as itself and not as a fabricated
   *  boolean. else-if nests, the python/cpp shape. */
  visitIf(n, parentId) {
    const cond = n.childForFieldName("condition");
    const alt = n.childForFieldName("alternative");
    const id = this.makeAnonId(parentId, "if");
    const node = {
      id, type: "if_stmt", parentId: parentId ?? null, ...this.pos(n),
      condition: cond ? this.text(cond) : "",
      hasElse: !!alt,
    };
    if (alt) node.elseLine = alt.startPosition.row + 1;
    // A call in the CONDITION is evaluated whichever arm runs, and it runs
    // BEFORE the branch — the condition-call floor hole, closed here by
    // construction, and emitted in evaluation order.
    if (cond) this.walkConditionCalls(cond, parentId);
    this.emit(node, parentId);
    const consequence = n.childForFieldName("consequence");
    if (consequence) this.visitBlock(consequence, id);
    for (const c of alt?.namedChildren ?? []) this.visit(c, id);
  }

  /** Calls written in a condition still RUN. They parent OUTSIDE the
   *  container (evaluated once, in the enclosing flow) — the rule
   *  parse_cst.py learned the hard way. */
  walkConditionCalls(cond, parentId) {
    const stack = [cond];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      if (cur.type === "call_expression") { this.mintCall(cur, cur, parentId); continue; }
      if (cur.type === "macro_invocation") { this.mintMacro(cur, cur, parentId); continue; }
      for (const c of cur.namedChildren) stack.push(c);
    }
  }

  /** NAMED LIMIT: a match flattens to ONE if_stmt whose arms are walked
   *  into it (the C++ switch precedent). */
  visitMatch(n, parentId) {
    const value = n.childForFieldName("value");
    const id = this.makeAnonId(parentId, "if");
    // The scrutinee is evaluated once, before any arm is chosen.
    if (value) this.walkConditionCalls(value, parentId);
    this.emit({
      id, type: "if_stmt", parentId: parentId ?? null, ...this.pos(n),
      condition: `match ${value ? this.text(value) : ""}`.trim(),
      hasElse: false,
    }, parentId);
    const body = n.childForFieldName("body");
    for (const arm of body?.namedChildren ?? []) {
      if (arm.type !== "match_arm") continue;
      const armValue = arm.childForFieldName("value");
      if (!armValue) continue;
      if (armValue.type === "block") this.visitBlock(armValue, id);
      else this.visitBareExpression(armValue, id);
    }
  }

  visitFor(n, parentId) {
    const pattern = n.childForFieldName("pattern");
    const value = n.childForFieldName("value");
    const id = this.makeAnonId(parentId, "for");
    // The ITERABLE is evaluated ONCE, before the loop — so it is emitted
    // outside the container AND ahead of it.
    if (value) this.walkConditionCalls(value, parentId);
    this.emit({
      id, type: "for_loop", parentId: parentId ?? null, ...this.pos(n),
      target: pattern ? this.text(pattern) : "_",
      iterName: value ? this.text(value) : "",
      iterSep: "in",
    }, parentId);
    const body = n.childForFieldName("body");
    if (body) this.visitBlock(body, id);
  }

  /** `while c`, `while let P = e`, and `loop` — which carries the keyword
   *  as its condition rather than a fabricated `true`. */
  visitWhile(n, parentId) {
    const cond = n.childForFieldName("condition");
    const id = this.makeAnonId(parentId, "while");
    this.emit({
      id, type: "while_loop", parentId: parentId ?? null, ...this.pos(n),
      condition: n.type === "loop_expression" ? "loop" : (cond ? this.text(cond) : ""),
    }, parentId);
    // A while TEST is re-evaluated every iteration, so a call in it is a
    // call in the loop — it parents INSIDE (parse_cst.py's rule).
    if (cond) this.walkConditionCalls(cond, id);
    const body = n.childForFieldName("body");
    if (body) this.visitBlock(body, id);
  }

  visitReturn(n, parentId) {
    const raw = n.namedChildren[0];
    const value = this.unwrap(raw);
    const id = this.makeAnonId(parentId, "return");
    const node = {
      id, type: "return_stmt", parentId: parentId ?? null, ...this.pos(n),
      value: raw ? this.preview(raw) : null,
    };
    if (value?.type === "call_expression") {
      const callee = this.calleeText(value);
      node.callTarget = callee;
      const effect = effectKindForCallee(callee);
      if (effect) node.effectKind = effect;
      this.registerCallSite(id, callee);
    } else if (value?.type === "macro_invocation") {
      node.callTarget = this.macroName(value);
    }
    this.emit(node, parentId);
    if (value?.type === "macro_invocation") this.stampMacroNests(value, node);
    else this.stampNests(value, node, id);
    if (value?.type === "call_expression") this.walkClosureArgs(value, parentId);
    if (value && CONTAINER_EXPRS.has(value.type)) this.visit(value, parentId);
  }

  /**
   * Same-file references. Rust has NO overloading, so a name that names
   * one definition here links — and unlike C++ a PATH callee links too,
   * because `Router::new` names exactly one function by construction.
   * The count check survives for `#[cfg]` pairs, which are the one way a
   * Rust file can define a name twice.
   */
  resolveLocalReferences() {
    for (const { id, callee } of this.callSites) {
      const bare = callee.replace(/::<[^>]*>/g, "");
      const tail = bare.split("::").pop();
      const isPath = bare.includes("::");
      // A bare name resolves against top-level fns. A path's tail
      // resolves only when the path's OWNER is a type in this file —
      // `Router::new` may take `new`, `Other::new` may not.
      if (isPath) {
        const owner = bare.split("::").slice(-2)[0];
        if (!this.typeIds.has(owner)) continue;
        const method = this.nodes.find(
          (x) => x.type === "function_def" && x.name === tail
            && x.parentId === this.typeIds.get(owner),
        );
        if (method) this.edges.push({ source: id, target: method.id, type: "reference" });
        continue;
      }
      if (this.fnDefCounts.get(tail) === 1) {
        this.edges.push({ source: id, target: this.functionIds.get(tail), type: "reference" });
      }
    }
  }
}

/** Build the IR of `source` — shared by parseFile and the rewriter (the
 *  edit floor mints and resolves ids through this one path). */
export async function buildFromSource(source) {
  const p = await getParser();
  const tree = p.parse(source);
  const b = new RustGraphBuilder(source);
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
    language: "rust",
    nodes: b.nodes,
    edges: b.edges,
    symbolIndex: b.symbolIndex,
  };
  if (b.modules.size) ir.modules = [...b.modules].sort();
  if (moduleId) ir.modulePath = moduleId;
  // Cargo identity, from the manifest above this file (see findManifest).
  const fileAbs = resolve(filePath);
  const manifest = findManifest(dirname(fileAbs));
  if (manifest) {
    const crateName = crateNameFrom(manifest.path);
    const where = cratePathFor(fileAbs, manifest.dir);
    if (crateName) ir.crateName = crateName;
    if (where) {
      ir.cratePath = where.path;
      if (where.isRoot) ir.crateRoot = true;
    }
  }
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
    process.stderr.write("usage: parse_rust.mjs <file> [--module-path <id>] | --batch\n");
    process.exit(2);
  }
  const mpIdx = argv.indexOf("--module-path");
  const moduleId = mpIdx !== -1 ? argv[mpIdx + 1] : undefined;
  try {
    const { ir, dropped } = await parseFile(file, moduleId);
    if (dropped > 0) ir.degraded = degradedNote(dropped);
    if (dropped > 0) process.stderr.write(`parse_rust: dropped ${dropped} unparseable construct(s) in ${file}\n`);
    process.stdout.write(JSON.stringify(ir, null, 2));
  } catch (e) {
    process.stderr.write(`parse_rust: ${e?.message ?? e}\n`);
    process.exit(1);
  }
}

export { parseFile };
