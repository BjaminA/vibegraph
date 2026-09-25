// M-BOUNDARY.1 (PLAN-M-BOUNDARY.md) — BOUNDARY ATTRIBUTION: the join from
// one external terminal of a logic thread to the stack TOOL it leaves the
// project through.
//
// M-STACK made the tools a fact and the policies a decision, but left the
// join to the reader: the contract listed "this thread's files use
// sqlite3, requests, flask" beside "this thread touches conn.commit(),
// _session().post(), request.get_json()" and never said which was which.
// A tool name is not recoverable from a label — `conn.commit` and
// `_session().post` spell a RECEIVER — so the join has to be derived from
// what the IR already resolved.
//
// FLOOR (the M-STACK floor, one level down): evidence, never inference.
// Every rule below reads something the parser or the linker already
// established — a resolved `qualifiedTarget`, an import binding in the
// owning file, a call-site the stack index already keyed, or the fact that
// the call lives INSIDE a project funnel. A boundary no rule reaches is
// returned as `null` and COUNTED as unattributed. Guessing a tool from a
// receiver name (`conn` looks like sqlite3) is exactly the M17.1 lie this
// project refuses.
//
// Webview-safe: pure data + pure functions over plain objects, no node
// imports (the taxonomy precedent — the thread tooltip and the server
// contract must attribute through the SAME code or they drift).

import {
  BASH_BUILTINS, BASH_RUNTIME_TOOL, CPP_RUNTIME_CALLS, FRAMEWORK_HANDLER_PARAMS,
  JSTS_GLOBAL_TOOLS, JSTS_RUNTIME_CALLS, RUST_RUNTIME_CALLS,
  PYTHON_RUNTIME_CALLS, classifyTool, isSafeToolName,
  jstsPackageName, pythonToolName, rustCrateName,
} from "./stack_taxonomy.ts";
import { PYTHON_BUILTIN_NAMES } from "./stack_stdlib.generated.ts";

export { JSTS_GLOBAL_TOOLS };

// ── inputs ───────────────────────────────────────────────────────────

/** One local name an import binds in one file, with the specifier it came
 *  from. `binding` is what a call's receiver head is matched against. */
export interface ImportBinding {
  /** local name bound in this file (`rq` for `import requests as rq`). */
  binding: string;
  /** the module specifier as written (`requests`, `flask`, `./db`). */
  spec: string;
  /** the specifier resolves INSIDE the project (relative, or a module the
   *  linker matched) — a call through it is project code, never a tool. */
  project?: boolean;
  nodeId?: string;
}

/** The shape `StackIndexRecord.tools[]` already has. Declared structurally
 *  so both the server index and the webview's wire record satisfy it
 *  without either importing the other. */
export interface StackToolLike {
  tool: string;
  role: string;
  origin: string;
  files: string[];
  wraps?: string[];
  /** origin "project": the file that IS the funnel (its importers are in
   *  `files` too, and are NOT inside it). */
  home?: string;
  /** M-CMD.2 — set when a stated policy gave this tool its role. */
  roleStatedBy?: string;
  /** M-CMD.3 — who stated it: human | orchestrator | agent. An agent's
   *  classification is labelled as unreviewed wherever the role shows. */
  roleStatedSource?: string;
  evidence?: ReadonlyArray<{ file: string; nodeId?: string; kind?: string }>;
}

export interface StackLike {
  tools: ReadonlyArray<StackToolLike>;
}

/** M-RESOLVE - one local name a file binds, and what it was bound FROM.
 *  `valueKind` is the IR's own vocabulary (list / dict / string / call /
 *  other); `callTarget` is the callee when it was a call. */
export interface LocalBinding {
  name: string;
  valueKind: string;
  callTarget?: string;
}

/** One boundary to attribute. Everything here is already on the thread
 *  node, the owning file's IR, or the index. */
export interface BoundaryInput {
  /** registry language id of the OWNING file (not the thread's seed). */
  language: string;
  /** the terminal's label — the call text head as the extractor found it. */
  label: string;
  kind: "external" | "dynamic" | "unresolved";
  /** M17.1 / §5.5 — the resolved dotted target, when the linker had one. */
  qualifiedTarget?: string | null;
  /** parse-time effect. Its PRESENCE keeps a bare name out of the builtin
   *  bucket: `open()` is a boundary, `len()` is not. */
  effectKind?: string | null;
  /** the file the call lives in; null when the caller could not say. */
  file?: string | null;
  /** the IR node id of the call (bash call-site evidence keys on it). */
  irNodeId?: string | null;
  /** the owning file's import bindings. */
  imports?: ReadonlyArray<ImportBinding>;
  /** M-RESOLVE - the owning file's LOCAL bindings, so a receiver bound
   *  three lines up can be resolved without a run. */
  locals?: ReadonlyArray<LocalBinding>;
  /** M-RESOLVE.3 - the route HANDLER this call sits inside, when it does:
   *  the framework its entry point recorded, and the handler's parameter
   *  names in order. */
  handler?: { framework?: string | null; params?: ReadonlyArray<string> } | null;
  stack?: StackLike | null;
}

// ── outputs ──────────────────────────────────────────────────────────

/** HOW the join was made — rendered, so a reader can weigh it.
 *   * `qualified`  — the linker resolved the callee (node-exact);
 *   * `call-site`  — the index already keyed this very call node (exact);
 *   * `binding`    — the receiver head is an import binding (file-exact);
 *   * `global`     — a language global with a role (`fetch`);
 *   * `funnel-file`— the call LIVES IN a project funnel; the callee itself
 *                    did not resolve (a file-level fact, weakest);
 *   * `builtin`    — not a boundary at all. */
export type AttributionHow =
  | "qualified" | "call-site" | "binding" | "global" | "funnel-file" | "builtin"
  // M-RESOLVE.2 - a bare call into the language's OWN runtime (`open`,
  // `fopen`, `echo`). For C++ the providing header must actually be
  // included: the include is the evidence, as an import is elsewhere.
  | "runtime"
  // M-RESOLVE - the receiver was resolved through a LOCAL binding in the
  // owning file: a literal (`problems = []`, so `.push` is list work and
  // not a boundary at all) or a call whose callee attributes (`conn =
  // sqlite3.connect(...)`, so `conn.execute` really is sqlite3).
  | "local-literal" | "local-binding"
  // M-RESOLVE.3 - the receiver is a route handler's framework-provided
  // parameter (`res` in an express handler), matched by POSITION.
  | "handler-param";

export interface Attribution {
  tool: string;
  role: string;
  origin: string;
  how: AttributionHow;
  /** the project funnel this call lives inside, when it does. */
  via?: string;
  /** what that funnel wraps (funnel attributions and `via` alike). */
  wraps?: string[];
  /** `funnel-file` only: the callee itself never resolved — the honest
   *  claim is "inside the funnel", NOT "is the wrapped tool". */
  calleeUnresolved?: true;
  /** the call goes through PROJECT code the linker did not follow. Not a
   *  tool; surfaced so a resolution gap reads as one. */
  projectModule?: string;
  /** M-CMD.2 — the role came from a STATED stack-policy (its constraint id),
   *  not a taxonomy table. Absent = a table said so. */
  roleStatedBy?: string;
  /** M-CMD.3 — that policy's source (human | orchestrator | agent). */
  roleStatedSource?: string;
}

// ── builtins (a bare name that is not a boundary) ─────────────────────
// A name here is skipped ONLY when the call carries no parse-time effect,
// so `open()` / `print()` stay boundaries.
//
// M-TABLES — Python's half is GENERATED from `dir(builtins)`, which is why
// it now covers every exception constructor rather than the thirteen that
// happened to break a fixture. JS keeps a hand list: `globalThis` in node
// answers a different question (it would hand back `process` and `Buffer`,
// which are runtime, not language), so this one is a CURATED set of
// ECMAScript globals and says so.

export const PYTHON_BUILTINS = new Set(PYTHON_BUILTIN_NAMES);

export const JSTS_BUILTINS = new Set([
  "Array", "Boolean", "Date", "Error", "EvalError", "Infinity", "JSON",
  "Map", "Math", "NaN", "Number", "Object", "Promise", "RangeError",
  "ReferenceError", "Reflect", "RegExp", "Set", "String", "Symbol",
  "SyntaxError", "TypeError", "URIError", "WeakMap", "WeakSet",
  "decodeURIComponent", "encodeURIComponent", "isFinite", "isNaN",
  "parseFloat", "parseInt", "structuredClone",
]);

/** IR `valueKind`s that name a CONTAINER or scalar the language owns. A
 *  method on one of these is local data work, not a boundary - which is
 *  what a third of every "unknown" in the real fixtures turned out to be
 *  (`problems = []` three lines above `problems.push`). */
const LITERAL_KIND_TOOL: Record<string, string> = {
  list: "list", tuple: "tuple", dict: "dict", set: "set",
  string: "string", fstring: "string", scalar: "number",
};

function isBuiltinName(language: string, head: string): boolean {
  switch (language) {
    case "python": return PYTHON_BUILTINS.has(head);
    case "jsts": return JSTS_BUILTINS.has(head);
    case "bash": return BASH_BUILTINS.has(head);
    default: return false;
  }
}

// ── helpers ──────────────────────────────────────────────────────────

/** The receiver head of a call label: `conn.commit` → `conn`,
 *  `_session().post` → `_session()`, `lines[0].split` → `lines[0]`. Only a
 *  plain identifier head can be an import binding; the rest fall through.
 *
 *  Rust qualifies with `::` — `use std::fs` binds `fs` and the call reads
 *  `fs::read_to_string`, so splitting on `.` alone left the head as the
 *  whole label and no binding could ever match. Language-aware on
 *  purpose: C++ labels are full of `::` (`std::fprintf`) and its
 *  attribution is measured where it stands. */
function headOf(label: string, language?: string): string {
  const stops = language === "rust" ? [label.indexOf("."), label.indexOf("::")] : [label.indexOf(".")];
  const at = stops.filter((i) => i !== -1).sort((a, b) => a - b)[0];
  return at === undefined ? label : label.slice(0, at);
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `module:Sym.method` (the IR's cross-file form) and `a.b.c` alike →
 *  the dotted root the taxonomy keys on. A target carrying a path
 *  separator or a source extension is PROJECT code, not a tool. */
function rootOfQualified(qt: string): { root: string; project: boolean } {
  const dotted = qt.replace(/:/g, ".");
  const first = dotted.split(".")[0] ?? dotted;
  const project = /[\\/]/.test(qt) || /\.(py|ts|tsx|mjs|cjs|js|sh|cpp|cc|h|hpp)\b/.test(qt);
  return { root: first, project };
}

/**
 * Is this import spec the project's OWN code, judged from the spec alone?
 *
 * Rust is the case that needs it. `use router_demo::store::Store` names
 * THIS crate, and nothing in the text says so — only the manifest does.
 * The stack index knows (it collects projectSpecs), but a reader working
 * from a FRESH post-edit IR does not, and that reader is the pre-check
 * that reports a new dependency. Without this it would call the
 * project's own module a third-party arrival: a false alarm, in a gate.
 */
export function isOwnCrateSpec(language: string, spec: string, crateName?: string | null): boolean {
  if (language !== "rust") return false;
  const root = rustCrateName(spec);
  if (root === null) return true;          // crate:: / self:: / super::
  return !!crateName && root === crateName;
}

function toolNameFor(language: string, spec: string): string {
  if (language === "python") return pythonToolName(spec);
  if (language === "jsts") return jstsPackageName(spec);
  // `use reqwest::blocking::Client` binds Client to the CRATE, not to the
  // module path it was reached through.
  if (language === "rust") return rustCrateName(spec) ?? spec;
  return spec;
}

/** The project funnel whose OWN file this is (never one of its importers:
 *  a file that imports the wrapper is beside it, not inside it). */
function funnelHome(stack: StackLike | null | undefined, file: string | null | undefined): StackToolLike | null {
  if (!stack || !file) return null;
  for (const t of stack.tools) {
    if (t.origin !== "project") continue;
    if (t.home ? t.home === file : t.files[0] === file) return t;
  }
  return null;
}

function fromTool(t: StackToolLike, how: AttributionHow): Attribution {
  return {
    tool: t.tool, role: t.role, origin: t.origin, how,
    ...(t.wraps?.length ? { wraps: [...t.wraps] } : {}),
  };
}

function classified(
  language: string, tool: string, how: AttributionHow,
  stack?: { tools: StackToolLike[] } | null,
): Attribution | null {
  if (!isSafeToolName(tool)) return null;
  // M-CMD.2 — the index's own record wins over the bare table: it was built
  // FROM the table and may carry a STATED role no table can, so a boundary
  // and the stack panel never disagree about what a tool is.
  const rec = stack?.tools.find((t) => t.tool === tool && t.origin !== "project");
  if (rec) {
    return {
      tool, role: rec.role, origin: rec.origin, how,
      ...(rec.roleStatedBy ? { roleStatedBy: rec.roleStatedBy } : {}),
      ...(rec.roleStatedSource ? { roleStatedSource: rec.roleStatedSource } : {}),
    };
  }
  const { role, origin } = classifyTool(language, tool);
  return { tool, role, origin, how };
}

// ── the rule ─────────────────────────────────────────────────────────

/**
 * Attribute one boundary to a tool, or return null.
 *
 * Order is first-match-wins and runs strongest evidence first: a resolved
 * callee, then a call site the index already keyed, then an import binding
 * in this file, then a language global, and only last the file-level fact
 * that the call lives inside a funnel. `via` is added to every attribution
 * whose call lives inside a funnel, so "sqlite3 via telemetry.storage"
 * reads as one thing.
 */
export function attributeBoundary(input: BoundaryInput): Attribution | null {
  const { language, label, qualifiedTarget, effectKind, file, irNodeId, stack } = input;
  const imports = input.imports ?? [];
  const head = headOf(label, language);
  const home = funnelHome(stack, file);

  const decorate = (a: Attribution | null): Attribution | null => {
    if (!a) return null;
    if (a.how === "builtin" || !home || home.tool === a.tool) return a;
    return { ...a, via: home.tool, wraps: home.wraps ? [...home.wraps] : a.wraps };
  };

  // 1. Not a boundary: a language builtin with no effect of its own.
  if (!effectKind && !label.includes(".") && isBuiltinName(language, head)) {
    return { tool: head, role: "builtin", origin: "language", how: "builtin" };
  }
  if (!effectKind && language === "jsts" && JSTS_BUILTINS.has(head) && label.includes(".")) {
    // `JSON.parse`, `Math.max`, `Object.keys` — a builtin namespace.
    return { tool: head, role: "builtin", origin: "language", how: "builtin" };
  }

  // 2. The linker resolved the callee (M17.1 viaLocal / §5.5 return type /
  //    M-FS8 imported bare name). Node-exact.
  if (qualifiedTarget) {
    // 2026-09-24 — a qualified target that starts with a THIRD-PARTY import
    // spec of this file is that package, whatever its spelling: a scoped npm
    // name has a slash (`@aws-sdk/client-s3.GetObjectCommand`), and the
    // path test below read every scoped SDK's calls as project code — so no
    // cloud service a JS project uses ever reached the architecture map.
    const spec = imports
      .filter((b) => !b.project && (qualifiedTarget === b.spec || qualifiedTarget.startsWith(`${b.spec}.`) || qualifiedTarget.startsWith(`${b.spec}:`)))
      .map((b) => b.spec)
      .sort((a, b) => b.length - a.length)[0];
    if (spec) return decorate(classified(language, toolNameFor(language, spec), "qualified", stack));
    const { root, project } = rootOfQualified(qualifiedTarget);
    if (project) {
      return decorate({
        tool: root, role: "unknown", origin: "project", how: "qualified",
        projectModule: qualifiedTarget,
      });
    }
    // M-ARCH.1 — `from layout_scale import classify_unit` binds
    // `classify_unit`, not `layout_scale`, so a qualified target rooted at the
    // MODULE found no binding by name and read as an unknown third-party tool
    // while the index knew the module was project code. The module's own
    // project binding answers for it.
    const binding = imports.find((b) => b.binding === root)
      ?? imports.find((b) => b.project && toolNameFor(language, b.spec) === root);
    if (binding?.project) {
      return decorate({
        tool: toolNameFor(language, binding.spec), role: "unknown", origin: "project",
        how: "qualified", projectModule: binding.spec,
      });
    }
    const a = classified(language, toolNameFor(language, binding?.spec ?? root), "qualified", stack);
    if (a) return decorate(a);
  }

  // 3. The stack index already keyed THIS call node (bash command words —
  //    `curl`, `psql`: the index's evidence rows carry the call's node id).
  if (stack && file && irNodeId) {
    for (const t of stack.tools) {
      if (t.origin === "project") continue;
      for (const e of t.evidence ?? []) {
        if (e.nodeId === irNodeId && e.file === file) return decorate(fromTool(t, "call-site"));
      }
    }
  }

  // 4. The receiver head is an import binding in this file. File-exact.
  //    LIMIT: parse_cst.py drops the alias on `from x import y as z`
  //    (import_from names carry no asname), so a call through `z` finds no
  //    binding and stays unattributed rather than being guessed.
  if (IDENT.test(head)) {
    const binding = imports.find((b) => b.binding === head);
    if (binding) {
      if (binding.project) {
        return decorate({
          tool: toolNameFor(language, binding.spec), role: "unknown", origin: "project",
          how: "binding", projectModule: binding.spec,
        });
      }
      const a = classified(language, toolNameFor(language, binding.spec), "binding", stack);
      if (a) return decorate(a);
    }
  }

  // 4b. M-RESOLVE - the receiver is a LOCAL, and the file says what it
  //     was bound from. Two shapes, and they are different claims:
  //       * a LITERAL (`problems = []`) - the call is list/dict work, so
  //         it is NOT a boundary at all and joins the builtin bucket;
  //       * a CALL whose callee attributes (`conn = sqlite3.connect(...)`)
  //         - the receiver IS that tool's object, so the call is a real
  //         boundary to it.
  //     A name bound more than once with DIFFERENT shapes is refused: the
  //     honest answer to a rebind is that the file does not say.
  if (IDENT.test(head)) {
    const bound = (input.locals ?? []).filter((b) => b.name === head);
    if (bound.length) {
      const kinds = new Set(bound.map((b) => b.valueKind));
      const targets = new Set(bound.map((b) => b.callTarget ?? ""));
      if (kinds.size === 1) {
        const kind = [...kinds][0];
        const container = LITERAL_KIND_TOOL[kind];
        if (container) {
          return { tool: container, role: "builtin", origin: "language", how: "local-literal" };
        }
        if (kind === "call" && targets.size === 1) {
          const callee = [...targets][0];
          // Resolve the CALLEE with the same rule set, minus the locals
          // (one hop only - a chain of local rebinds is a run's job).
          if (callee && callee !== head) {
            const via = attributeBoundary({ ...input, label: callee, qualifiedTarget: null, locals: [] });
            // M-RESOLVE.4 - `const store = new Map()` then `store.get(k)`.
            // The recursion resolves the CALLEE to a language builtin, and
            // the rule used to drop that on the floor because a builtin is
            // not a tool. It is not a tool - it is not a BOUNDARY either.
            // Same reading as a container literal, and the same refusal to
            // derive an effect from it.
            if (via && via.how === "builtin") {
              return { tool: via.tool, role: "builtin", origin: "language", how: "local-literal" };
            }
            if (via && via.how !== "funnel-file" && !via.projectModule) {
              return decorate({ ...via, how: "local-binding" });
            }
          }
        }
      }
    }
  }

  // 4c-i. M-RESOLVE.4 - a JS runtime namespace called through its global.
  //     Dotted, so the bare-name rule below cannot see it; effectful, so
  //     rule 1 was right to refuse to call it a non-boundary. Writing to
  //     stdout IS leaving the project, and now it says through what.
  if (effectKind && language === "jsts" && label.includes(".") && JSTS_RUNTIME_CALLS[head]) {
    return decorate({ tool: JSTS_RUNTIME_CALLS[head], role: "runtime", origin: "stdlib", how: "runtime" });
  }

  // 4c. M-RESOLVE.2 - the language's own runtime, called by bare name.
  //     Only for a call the parser already found EFFECTFUL, so this never
  //     pulls a pure builtin like `len` out of the not-a-boundary bucket.
  if (effectKind && !label.includes(".")) {
    if (language === "python" && PYTHON_RUNTIME_CALLS[label]) {
      return decorate({ tool: PYTHON_RUNTIME_CALLS[label], role: "runtime", origin: "stdlib", how: "runtime" });
    }
    if (language === "bash" && BASH_BUILTINS.has(label)) {
      return decorate({ tool: BASH_RUNTIME_TOOL, role: "runtime", origin: "stdlib", how: "runtime" });
    }
    if (language === "rust" && RUST_RUNTIME_CALLS[label]) {
      // `println!` / `eprintln!` — std, by the language's own definition,
      // so no evidence gate is needed (C++ needs one below because a
      // symbol there does not name its header).
      return decorate({ tool: RUST_RUNTIME_CALLS[label], role: "runtime", origin: "stdlib", how: "runtime" });
    }
    if (language === "cpp") {
      const header = CPP_RUNTIME_CALLS[label];
      // EVIDENCE GATE: only when this file really includes that header.
      // Without it this would be the symbol->header guess M-LANG5a's
      // overload honesty refuses, and a build graph is what would be
      // needed to do it properly.
      const included = header && file
        && (stack?.tools ?? []).some((t) => t.tool === header && t.files.includes(file));
      if (included) {
        return decorate({ tool: header, role: "runtime", origin: "stdlib", how: "runtime" });
      }
    }
  }

  // 4d. M-RESOLVE.3 - a route handler's leading parameters belong to its
  //     framework. Matched by POSITION, so `(_, res)` still works and a
  //     local named `res` in an unrelated function still does not.
  const fw = input.handler?.framework;
  const owned = fw ? FRAMEWORK_HANDLER_PARAMS[fw] : undefined;
  if (owned && IDENT.test(head)) {
    const params = (input.handler?.params ?? []).map((x) => String(x).split(/[:=]/)[0].trim());
    const idx = params.indexOf(head);
    if (idx !== -1 && idx < owned) {
      const a = classified(language, fw!, "handler-param");
      if (a) return decorate(a);
    }
  }

  // 5. A language global that IS a tool (`fetch`).
  if (language === "jsts" && JSTS_GLOBAL_TOOLS[head]) {
    return decorate({ tool: head, role: JSTS_GLOBAL_TOOLS[head], origin: "stdlib", how: "global" });
  }

  // 6. The call lives INSIDE a project funnel and nothing above resolved
  //    it: the honest claim is where it lives, not what it reaches.
  //    NARROW on purpose — only a call that plausibly reaches OUT counts:
  //    a method call on some receiver (`_session().post`) or a call the
  //    parser already found effectful. A bare unresolved name inside the
  //    funnel is a local helper or a builtin, and calling it "through the
  //    funnel" would invent both a tool and (via the role) an effect.
  if (home && (label.includes(".") || !!effectKind)) {
    return {
      tool: home.tool, role: home.role, origin: "project", how: "funnel-file",
      ...(home.wraps?.length ? { wraps: [...home.wraps] } : {}),
      calleeUnresolved: true,
    };
  }

  return null;
}

// ── import bindings out of one file's IR ─────────────────────────────

interface IrNodeLike {
  id?: unknown;
  type?: unknown;
  module?: unknown;
  names?: unknown;
}

/** `x`, `x as y`, `* as y` → the local name bound. */
function bindingOf(entry: string): string {
  const asIdx = entry.indexOf(" as ");
  if (asIdx !== -1) return entry.slice(asIdx + 4).trim();
  // `import os.path` binds `os`; a from-import name binds itself.
  return entry.split(".")[0].trim();
}

/**
 * The import bindings of ONE file, from its IR nodes. Shared so the
 * contract, the index and the tooltip read imports the same way.
 *
 * `isProjectSpec` decides whether a specifier points inside the project —
 * injected because that answer is per-language and per-project (the linker
 * knows it; this module must not re-implement resolution).
 */
export function importBindings(
  nodes: ReadonlyArray<IrNodeLike>,
  language: string,
  isProjectSpec?: (spec: string) => boolean,
): ImportBinding[] {
  const out: ImportBinding[] = [];
  const push = (binding: string, spec: string, nodeId?: string): void => {
    if (!binding || !spec) return;
    const project = spec.startsWith(".") || spec.startsWith("/") || !!isProjectSpec?.(spec);
    out.push({ binding, spec, ...(project ? { project: true } : {}), ...(nodeId ? { nodeId } : {}) });
  };
  for (const n of nodes) {
    const type = n?.type;
    if (type !== "import" && type !== "import_from") continue;
    const nodeId = typeof n.id === "string" ? n.id : undefined;
    const names = Array.isArray(n.names) ? n.names.filter((x): x is string => typeof x === "string") : [];
    const mod = typeof n.module === "string" ? n.module : "";
    if (type === "import_from") {
      // python: `from flask import request` → request ↦ flask.
      // jsts:   `import express from "express"` → express ↦ express;
      //         `import { a as b } from "x"`   → b ↦ x.
      // rust:   `use std::fs`                  → fs ↦ std;
      //         `use reqwest::blocking::Client`→ Client ↦ reqwest.
      //         A wildcard binds no name that can be attributed.
      for (const entry of names) {
        if (language === "rust" && entry === "*") continue;
        push(bindingOf(entry), mod, nodeId);
      }
      continue;
    }
    // python `import requests` / `import requests as rq` / `import os.path`.
    // bash `source lib/env.sh` and C++ `#include <x>` bind no callable
    // name, so they contribute nothing here (their boundaries attribute by
    // call site, or not at all).
    if (language !== "python" && language !== "jsts") continue;
    for (const entry of names) push(bindingOf(entry), entry.split(" as ")[0].trim(), nodeId);
  }
  return out;
}

// ── role → effect (display only) ─────────────────────────────────────

/** A tool's ROLE implies what a call through it costs, for the roles that
 *  map onto the existing effect vocabulary. Contract/display only:
 *  NEVER written to the IR and never read by scan_effects.py — the §5.5
 *  floor is that the run gate must not loosen on an inference. */
const ROLE_EFFECT: Record<string, string> = {
  db: "db",
  "http-client": "http",
  process: "subprocess",
  remote: "subprocess",
  // M-CMD.2 — a call INTO a hosted-model client is a network round trip,
  // like http-client, and it inherits every guard above: only a STRONG
  // attribution derives it (the import binding, a resolved callee), never
  // a local instance or a funnel file.
  "model-api": "http",
  // M-CMD.3 — a call INTO a platform client (a Volt, firebase, supabase)
  // is a network round trip to the platform, whatever the platform then
  // does with it (query its database, run an allow-listed command). `http`
  // is the honest common denominator; `remote`'s `subprocess` would claim
  // a shell that is not there. Same guards as every other row.
  platform: "http",
  // `agent-protocol` is deliberately ABSENT. From the role alone a tool
  // REGISTRATION (`server.registerTool`) and a tool CALL (`client.callTool`)
  // are the same import, and measured on a real MCP server that is 75 to 8:
  // deriving an effect here would fabricate 75 boundaries. The tool is still
  // attributed, so the contract's "Leaves the project through" names it.
};

export function effectFromRole(a: Attribution | null | undefined): string | null {
  if (!a || a.how === "builtin" || a.projectModule) return null;
  // NOT from `funnel-file`. That attribution says only where a call LIVES,
  // and a derived effect drives the round-trip (N+1) warning — too strong a
  // claim for too weak a fact. `res.json()` inside an HTTP funnel parses a
  // body; calling it an http round trip invented an N+1 that is not there.
  // An effect is derived only when the rule knew WHAT is called.
  if (a.how === "funnel-file") return null;
  // M-RESOLVE - nor from a local binding. Knowing `res` came from
  // `fetch()` says what the OBJECT is, not that `res.json()` crosses the
  // network; deriving http there is the same fabricated N+1 the funnel
  // rule already refuses.
  if (a.how === "local-binding" || a.how === "local-literal") return null;
  // M-RESOLVE.2 - a runtime call's effect is the one the parser already
  // stamped (`open` is fs). Deriving one from role "runtime" would say
  // nothing and risk saying it wrongly.
  if (a.how === "runtime") return null;
  // M-RESOLVE.3 - `res.status(400)` sets a field and `res.json(...)`
  // writes a response. Neither is a round trip this project pays, so a
  // web-framework role must not manufacture one here.
  if (a.how === "handler-param") return null;
  return ROLE_EFFECT[a.role] ?? null;
}

/** M-CMD.3 — how a STATED role is labelled everywhere it shows (the
 *  contract's boundary line, the spec's fact line, the tooltip). A human's
 *  statement is authoritative; a model's classification is provisional and
 *  says so on the line, because a reader who cannot tell the two apart
 *  will trust the second like the first. */
export function statedRoleLabel(id: string, source?: string): string {
  if (source === "agent") return `role classified by ${id} (agent, NOT human-reviewed)`;
  if (source === "orchestrator") return `role stated by ${id} (orchestrator)`;
  return `role stated by ${id}`;
}

/** One boundary's tool, as prompts and panels say it. */
export function attributionLabel(a: Attribution): string {
  if (a.how === "builtin") return a.tool;
  if (a.how === "local-literal") return `${a.tool} (local ${a.tool} literal)`;
  if (a.projectModule) return `${a.tool} [project code, unlinked]`;
  if (a.how === "funnel-file") {
    return `inside ${a.tool} (project funnel${a.wraps?.length ? ` wrapping ${a.wraps.join(", ")}` : ""})`;
  }
  const bits = [a.role];
  if (a.origin === "stdlib") bits.push("stdlib");
  if (a.origin === "project") bits.push("project funnel");
  if (a.origin === "unknown") bits.push("origin unknown");
  if (a.roleStatedBy) bits.push(statedRoleLabel(a.roleStatedBy, a.roleStatedSource));
  return `${a.tool} [${bits.join(", ")}]${a.via ? ` via ${a.via}` : ""}`;
}

/**
 * M-RESOLVE - the local bindings of ONE file, from its IR nodes.
 *
 * Assignment nodes already carry `name`, `valueKind` and `callTarget`;
 * this is only a projection of them. Shared so the contract, the index
 * and the tooltip resolve a receiver the same way.
 */
export function localBindings(nodes: ReadonlyArray<IrNodeLike & { name?: unknown; valueKind?: unknown; callTarget?: unknown; augmented?: unknown }>): LocalBinding[] {
  const out: LocalBinding[] = [];
  for (const n of nodes) {
    if (n?.type !== "assignment") continue;
    const name = typeof n.name === "string" ? n.name : "";
    const valueKind = typeof n.valueKind === "string" ? n.valueKind : "";
    if (!name || !valueKind) continue;
    // `self.x = ...` binds an attribute, not a local name.
    if (name.includes(".")) continue;
    // An AUGMENTED assignment MUTATES a name; it does not bind it. The
    // name already refers to something, and `x += f()` says nothing about
    // what that something is. Reading it as a binding produced a flatly
    // false tooltip on the C++ review fixture: `router += Router::parse(raw)`
    // made the receiver `router` report as "a local binding from
    // net::Router::parse()", when it is default-constructed and never
    // reassigned. The operator has always been on Python's IR (`augmented`,
    // M-CONTRACT.5) and was simply never read here.
    if (typeof n.augmented === "string" && n.augmented) continue;
    out.push({
      name, valueKind,
      ...(typeof n.callTarget === "string" && n.callTarget ? { callTarget: n.callTarget } : {}),
    });
  }
  return out;
}
