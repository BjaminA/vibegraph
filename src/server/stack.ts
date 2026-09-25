// M-STACK.1 (PLAN-M-STACK.md) — STACK FACTS: which software tools this
// project actually uses, derived from the IR and the manifests on disk.
// Deterministic, evidence-only, never guessed.
//
// The three vocabularies stay apart (the milestone's central floor):
//   * a stack FACT is what the code shows — this file imports `requests`,
//     this thread's HTTP leaves through `telemetry.http_client`;
//   * a stack POLICY is a STATED decision with provenance (constraint
//     store, kind `stack-policy`);
//   * the system SPEC (stack_spec.ts) renders the two TOGETHER, never
//     letting one overwrite the other.
//
// A tool the taxonomy does not know is listed with role "unknown" — the
// spec names what it cannot classify. Versions come only from manifests
// (requirements*.txt / pyproject.toml / package.json); a project with no
// manifest gets no versions, and the detection stands on imports alone.

import * as fs from "fs";
import * as path from "path";
import { languageForPath } from "../shared/languages.ts";
// M-CMD.2 — a stated stack-policy may carry a `role` for a tool no table
// knows. No cycle: constraint_store's value imports never reach this file.
import { loadConstraints, type ConstraintSource } from "./constraint_store.ts";
import {
  BASH_BUILTINS, CONFIG_TOOLS, JSTS_GLOBAL_TOOLS, ROLE_ORDER, RUST_TOOLS,
  classifyTool, isRustStd, isSafeToolName, jstsPackageName, pythonToolName,
  rustCrateName,
  type StackOrigin, type StackRole,
} from "../shared/stack_taxonomy.ts";
// Wire shapes live in protocol.ts (the panel renders the same record the
// index builds); re-exported here so server code has one import point —
// the constraint_store precedent.
import type { StackEvidenceRef, StackToolRecord, StackIndexRecord } from "../shared/protocol.ts";
import { importBindings, localBindings, attributeBoundary, isOwnCrateSpec, type ImportBinding, type LocalBinding } from "../shared/stack_attribution.ts";

export type { StackRole, StackOrigin };
export type StackEvidence = StackEvidenceRef;
export type StackTool = StackToolRecord;
export type StackIndex = StackIndexRecord;

export interface StackEnvelopeLike {
  files: Record<string, { nodes?: any[]; edges?: any[]; modulePath?: string; language?: string }>;
  /** M-BOUNDARY.2 — `nodes` is optional: without it the index still reports
   *  PRESENCE (`byThread`), just no `calledOn` / `byThreadCalled`. */
  threads?: Array<{
    entryPointId?: string | null;
    filesReached?: string[];
    nodes?: Array<{
      id?: string; kind?: string; label?: string; file?: string | null;
      irNodeId?: string | null; qualifiedTarget?: string; effectKind?: string;
    }>;
  }>;
}

/** The terminal kinds a thread's boundaries take (extract_thread's shape). */
const TERMINAL_KINDS = new Set(["external", "dynamic", "unresolved"]);

/** A project module becomes a TOOL (the proxy / wrapper case) when it
 *  funnels a roled third-party or stdlib tool and at least this many OTHER
 *  project files reach it.
 *
 *  PLAN-M-STACK wrote "≥ 2"; the milestone's own acceptance case —
 *  `telemetry/http_client.py`, the one outbound HTTP path in
 *  examples/fleet-telemetry — is imported by exactly ONE module. The
 *  funnel property is about being the path, not about popularity, so the
 *  threshold is 1: a module nothing else reaches is not a funnel, a module
 *  one other reaches is. */
const WRAPPER_MIN_IMPORTERS = 1;

/** Roles that make a project module a genuine funnel. A module that only
 *  imports stdlib plumbing (`os`, `time`) is not "the proxy". */
const WRAPPABLE = new Set<StackRole>([
  "http-client", "db", "cache", "queue", "tensor", "data", "cloud",
  "remote", "process", "web-framework",
  // M-CMD.2 — a module wrapping a hosted-model client or an agent-protocol
  // SDK IS the project's path to that boundary (a real codebase's
  // `section-stream` wrapped openai for 12 files and could not be seen).
  "model-api", "agent-protocol",
  // M-CMD.3 — the module that builds the platform request IS the funnel
  // (a real codebase's `backendCommand.ts`: "the ONE place a Volt
  // CommandStream request is built").
  "platform",
]);

// M-CMD.1 removed `frontend` and TRIED `unknown`. The run on a real codebase
// settled both, in opposite directions — recorded because the argument for
// `unknown` was a good one and it was still wrong:
//
//   `frontend` OUT, and it stays out. Importing `react` is not funnelling
//   react: every component does it, so the role selected for triviality —
//   58 of that codebase's 100 "funnels" were React components reaching two
//   files each. Censused across every polyglot fixture and example first:
//   14 funnels, NONE of role `frontend`.
//
//   `unknown` IN, then OUT. The argument was that being unable to name a
//   tool is not evidence its wrapper is trivial, and that the three funnels
//   the review named (49, 53 and 76 importers, one self-documented as "the
//   ONE place a CommandStream request is built") were missed for exactly
//   that reason. Measured on the same codebase, it bought 210 funnels whose
//   commonest wraps were `clsx` ×79, `lucide-react` ×46, `zod` ×44,
//   `recharts` and `zustand` — utility libraries, not boundaries — and it
//   caught NONE of the three, because all three take the client as a
//   PARAMETER and import no tool at all. It traded one noise class for a
//   larger one and bought nothing it was added for.
//
// What the same measurement says to do instead: `openai` (8) and
// `@modelcontextprotocol/sdk` (49) turned up in that noise and ARE
// boundaries — they need ROLES, which is the open item, not a wildcard. And
// a funnel that imports nothing needs a different rule than a role table,
// which is the other open item. Neither is answered by widening this set.

// ── raw observations ─────────────────────────────────────────────────

interface Observation {
  tool: string;
  file: string;
  nodeId?: string;
  line?: number;
  kind: StackEvidence["kind"];
  language: string;
}

/** file → the project files it imports (resolved), per language. */
type ImportGraph = Map<string, Set<string>>;

function dirOf(file: string): string {
  const i = file.lastIndexOf("/");
  return i === -1 ? "" : file.slice(0, i);
}

function joinRel(dir: string, rest: string): string {
  const parts = (dir ? dir.split("/") : []).concat(rest.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") { out.pop(); continue; }
    out.push(p);
  }
  return out.join("/");
}

function collect(env: StackEnvelopeLike): { observations: Observation[]; imports: ImportGraph; projectSpecs: Set<string> } {
  const files = Object.keys(env.files);
  const fileSet = new Set(files);
  const byModulePath = new Map<string, string>();
  const modulePrefixes = new Set<string>();
  for (const [f, ir] of Object.entries(env.files)) {
    const mp = typeof ir.modulePath === "string" ? ir.modulePath : "";
    if (!mp) continue;
    byModulePath.set(mp, f);
    const segs = mp.split(".");
    for (let i = 1; i <= segs.length; i++) modulePrefixes.add(segs.slice(0, i).join("."));
  }
  const basenames = new Map<string, string>();
  for (const f of files) basenames.set(f.split("/").pop()!, f);
  // M-ARCH.1 — every Python module name a parsed file answers to (`x.py`,
  // `x/__init__.py`), for imports the linker did not resolve.
  const pyModuleFiles = new Map<string, string[]>();
  for (const f of files) {
    const m = /(?:^|\/)([A-Za-z_][A-Za-z0-9_]*)(?:\.py|\/__init__\.py)$/.exec(f);
    if (!m) continue;
    pyModuleFiles.set(m[1], [...(pyModuleFiles.get(m[1]) ?? []), f]);
  }
  // M-CMD.3 — every shell function this project DEFINES, in any bash file.
  // The linker resolves a call to a function sourced by a literal path;
  // one sourced through a variable (`source "$DIR/lib.sh"`) is a bare word
  // to it, and the first real codebase listed six of its own helpers
  // (`run_orch`, `safe_cache_key`, …) as unclassified third-party tools.
  // A word the project defines somewhere is project code wherever it is
  // called; which definition is a resolution question, not a stack one.
  const bashDefined = new Set<string>();
  for (const [f, ir] of Object.entries(env.files)) {
    const lang = languageForPath(f)?.id ?? (typeof ir.language === "string" ? ir.language : "");
    if (lang !== "bash") continue;
    for (const n of ir.nodes ?? []) {
      if (n?.type === "function_def" && typeof n.name === "string") bashDefined.add(n.name);
    }
  }

  const observations: Observation[] = [];
  const imports: ImportGraph = new Map();
  // M-BOUNDARY.1 — `file|spec` for every specifier that resolves inside
  // the project, so import BINDINGS know which names are project code.
  const projectSpecs = new Set<string>();
  const addImport = (from: string, to: string) => {
    if (from === to) return;
    if (!imports.has(from)) imports.set(from, new Set());
    imports.get(from)!.add(to);
  };

  // Cross-file `reference` edges are already resolved by the linkers: a
  // file that CALLS into another reaches it, whatever the import spelling.
  for (const [f, ir] of Object.entries(env.files)) {
    for (const e of ir.edges ?? []) {
      if (e?.type === "reference" && typeof e.targetFile === "string" && fileSet.has(e.targetFile)) {
        addImport(f, e.targetFile);
      }
    }
  }

  for (const [file, ir] of Object.entries(env.files)) {
    const lang = languageForPath(file)?.id ?? (typeof ir.language === "string" ? ir.language : "");
    if (!lang) continue;
    const nodes = ir.nodes ?? [];
    // bash: a call that resolves to a project function is never a tool.
    const resolvedCalls = new Set<string>();
    if (lang === "bash") {
      for (const e of ir.edges ?? []) {
        if (e?.type === "reference" && typeof e.source === "string") resolvedCalls.add(e.source);
      }
    }

    for (const n of nodes) {
      const t = n?.type;
      if (lang === "python" && (t === "import" || t === "import_from")) {
        const specs: string[] = t === "import_from"
          ? [typeof n.module === "string" ? n.module : ""]
          : (Array.isArray(n.names) ? n.names.filter((x: unknown) => typeof x === "string") : []);
        for (const raw of specs) {
          // `import cache as cachelib` carries the name "cache as cachelib";
          // the MODULE is "cache". Read whole, an aliased import of the
          // project's own module matched nothing and read as a third-party
          // tool (2026-09-25: three of a private production codebase's pipeline modules, imported
          // `as dl` / `as cmp` / `as pfs`, were on its map as unknown tools).
          const spec = raw.split(/\s+as\s+/)[0].trim();
          if (!spec) continue;
          if (spec.startsWith(".")) continue; // explicit relative import — project, by construction
          const target = byModulePath.get(spec)
            ?? (fileSet.has(joinRel(dirOf(file), spec.split(".").join("/") + ".py"))
              ? joinRel(dirOf(file), spec.split(".").join("/") + ".py")
              : fileSet.has(joinRel(dirOf(file), spec.split(".").join("/") + "/__init__.py"))
                ? joinRel(dirOf(file), spec.split(".").join("/") + "/__init__.py")
                : undefined);
          if (target) { addImport(file, target); projectSpecs.add(`${file}|${spec}`); continue; }
          if (modulePrefixes.has(spec.split(".")[0])) { projectSpecs.add(`${file}|${spec}`); continue; } // this project's own package
          // M-ARCH.1 — a module FILE this project parses, imported across a
          // directory the linker did not follow (a sibling pipeline dir on
          // sys.path, a package located by an env var). The file exists, so
          // it is project code with a resolution gap, never a third-party
          // dependency — only when no table claims the name (a local
          // `json.py` must not hide the standard library). A real codebase
          // listed five of its own modules as unknown tools for this.
          {
            const root0 = spec.split(".")[0];
            const owners = pyModuleFiles.get(root0);
            if (owners && classifyTool("python", pythonToolName(spec)).role === "unknown") {
              projectSpecs.add(`${file}|${spec}`);
              if (owners.length === 1) addImport(file, owners[0]);
              continue;
            }
          }
          observations.push({ tool: pythonToolName(spec), file, nodeId: n.id, line: n.line, kind: "import", language: lang });
        }
      } else if (lang === "jsts" && (t === "import" || t === "import_from")) {
        const spec = typeof n.module === "string" ? n.module : "";
        if (!spec) continue;
        // M-CMD.1 — `@/lib/db` is this project's own file. Without the alias
        // the index listed a project's own directories (`@/app`, `@/lib`) as
        // third-party dependencies and no internal call chain resolved
        // (an internal field review B4). The PARSER resolved and probed it;
        // this reads that one fact.
        if (typeof n.aliasTarget === "string" && fileSet.has(n.aliasTarget)) {
          projectSpecs.add(`${file}|${spec}`);
          addImport(file, n.aliasTarget);
          continue;
        }
        // M-CMD.3 — `@/x` is a PATH ALIAS by construction: npm forbids an
        // empty scope, so no package can be named this way. When the parser
        // could not stamp `aliasTarget` (the target is a .jsx, a CSS module,
        // a directory index — nothing the IR reads) that is a resolution
        // gap in the project's own code, not a third-party dependency, and
        // the first real codebase listed `@/app`, `@/components`, `@/lib`
        // among its unclassified tools for it.
        if (/^@\//.test(spec)) { projectSpecs.add(`${file}|${spec}`); continue; }
        if (spec.startsWith(".") || spec.startsWith("/")) {
          projectSpecs.add(`${file}|${spec}`);
          const base = joinRel(dirOf(file), spec.replace(/\.(m?js|ts|tsx)$/, ""));
          for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
            if (fileSet.has(cand)) { addImport(file, cand); break; }
          }
          continue;
        }
        observations.push({ tool: jstsPackageName(spec), file, nodeId: n.id, line: n.line, kind: "import", language: lang });
      } else if (lang === "jsts") {
        // M-BOUNDARY.1 — a GLOBAL with a role (`fetch`) is a tool this file
        // uses, and nothing imports it: before this, the index could not
        // answer "what HTTP client does the gateway use?" for a codebase
        // that calls fetch. Same evidence shape as a bash command word (a
        // node whose callee IS the tool), so the boundary join lands on the
        // very node the index keyed. The callee rides `funcName` on a bare
        // call and `callTarget` on the far commoner `const res = await
        // fetch(…)` assignment — read both, or the tool is invisible.
        const callee = typeof n.funcName === "string" ? n.funcName
          : typeof n.callTarget === "string" ? n.callTarget : "";
        const head = callee.split(".")[0];
        if (head && JSTS_GLOBAL_TOOLS[head]) {
          observations.push({ tool: head, file, nodeId: n.id, line: n.line, kind: "call", language: lang });
        }
      } else if (lang === "bash") {
        if (t === "import") {
          const spec = Array.isArray(n.names) && typeof n.names[0] === "string" ? n.names[0] : "";
          if (!spec) continue;
          for (const cand of [joinRel(dirOf(file), spec), spec]) {
            if (fileSet.has(cand)) { addImport(file, cand); break; }
          }
        } else if (t === "call") {
          const word = typeof n.funcName === "string" ? n.funcName : "";
          if (!word || resolvedCalls.has(n.id) || BASH_BUILTINS.has(word) || bashDefined.has(word)) continue;
          observations.push({ tool: word, file, nodeId: n.id, line: n.line, kind: "call", language: lang });
        }
      } else if (lang === "rust") {
        if (t === "import_from") {
          // `use crate::…` / `self::` / `super::` name this project's own
          // modules; the cross-file reference edge above already recorded
          // the dependency, so there is no TOOL here to observe.
          const spec = typeof n.module === "string" ? n.module : "";
          const root = rustCrateName(spec);
          if (!root) { projectSpecs.add(`${file}|${spec}`); continue; }
          // The crate's own name reaching into its lib (a bin or an
          // integration test) is equally not a dependency.
          if (root === crateNameOf(ir)) { projectSpecs.add(`${file}|${spec}`); continue; }
          observations.push({ tool: root, file, nodeId: n.id, line: n.line, kind: "import", language: lang });
        } else if (t === "import") {
          // `mod x;` names a FILE of this crate, never a tool.
          continue;
        } else {
          // A crate reached by PATH with no `use` — `reqwest::blocking::get(u)`
          // is a complete call on its own. The jsts global-tool precedent:
          // observe it as a call so a dependency used this way still appears.
          const callee = typeof n.funcName === "string" ? n.funcName
            : typeof n.callTarget === "string" ? n.callTarget : "";
          if (!callee || !callee.includes("::")) continue;
          const root = rustCrateName(callee);
          if (!root || isRustStd(root) || root === crateNameOf(ir)) continue;
          if (!RUST_TOOLS[root] && !root.startsWith("aws_sdk_")) continue;
          observations.push({ tool: root, file, nodeId: n.id, line: n.line, kind: "call", language: lang });
        }
      } else if (lang === "cpp" && t === "import") {
        const raw = Array.isArray(n.names) && typeof n.names[0] === "string" ? n.names[0] : "";
        if (!raw) continue;
        const angled = raw.startsWith("<") && raw.endsWith(">");
        const header = angled ? raw.slice(1, -1) : raw;
        if (!angled) {
          const local = basenames.get(header.split("/").pop()!);
          if (local) { addImport(file, local); continue; }
        }
        observations.push({ tool: header, file, nodeId: n.id, line: n.line, kind: "include", language: lang });
      }
    }
  }
  return { observations, imports, projectSpecs };
}

/** The crate a Rust IR belongs to, as the parser read it from the
 *  manifest above the file. Absent when no Cargo.toml was found — then a
 *  `use <name>::…` is left as an external tool rather than assumed ours. */
function crateNameOf(ir: any): string | null {
  return typeof ir?.crateName === "string" ? ir.crateName : null;
}

// ── manifests (versions + config-only evidence) ──────────────────────

interface Manifests {
  versions: Map<string, string>;
  /** package.json dependency names, for tools declared but never imported. */
  declared: Array<{ tool: string; file: string }>;
  configs: Array<{ tool: string; role: StackRole; file: string }>;
}

function readManifests(root: string | undefined): Manifests {
  const versions = new Map<string, string>();
  const declared: Manifests["declared"] = [];
  const configs: Manifests["configs"] = [];
  if (!root) return { versions, declared, configs };
  let entries: string[] = [];
  try { entries = fs.readdirSync(root); } catch { return { versions, declared, configs }; }

  const read = (name: string): string | null => {
    try { return fs.readFileSync(path.join(root, name), "utf-8"); } catch { return null; }
  };

  for (const name of entries) {
    if (/^requirements.*\.txt$/.test(name)) {
      for (const line of (read(name) ?? "").split("\n")) {
        const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:==|>=|~=)\s*([0-9][^\s;#]*)/.exec(line);
        if (m) versions.set(m[1].toLowerCase(), m[2]);
      }
    } else if (name === "pyproject.toml") {
      const text = read(name) ?? "";
      for (const m of text.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:==|>=|~=)\s*([0-9][^"'\s,]*)["']/g)) {
        versions.set(m[1].toLowerCase(), m[2]);
      }
    } else if (name === "package.json") {
      try {
        const pkg = JSON.parse(read(name) ?? "{}") as Record<string, any>;
        for (const key of ["dependencies", "devDependencies"]) {
          for (const [dep, ver] of Object.entries(pkg[key] ?? {})) {
            if (!isSafeToolName(dep)) continue;
            declared.push({ tool: dep, file: name });
            if (typeof ver === "string") versions.set(dep.toLowerCase(), ver.replace(/^[\^~]/, ""));
          }
        }
      } catch { /* an unparsable manifest yields no facts, never a guess */ }
    } else if (name === "Cargo.toml") {
      // Line-oriented on purpose: a TOML parser is a dependency for two
      // sections. NAMED LIMIT — the ROOT manifest only, so a workspace's
      // member crates are not read.
      let section = "";
      for (const raw of (read(name) ?? "").split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("[")) { section = line; continue; }
        if (!/^\[(dependencies|dev-dependencies|build-dependencies)\]$/.test(section)) continue;
        // `serde = "1.0"` · `serde = { version = "1.0", … }` ·
        // `serde.workspace = true` (version lives in the workspace root,
        // which this reader does not open — so the crate is DECLARED with
        // no version rather than given a wrong one).
        const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
        if (!m) continue;
        const cargoName = m[1].split(".")[0];
        if (!isSafeToolName(cargoName)) continue;
        declared.push({ tool: cargoName, file: name });
        const ver = /version\s*=\s*"([^"]+)"/.exec(line) ?? /^[^=]+=\s*"([^"]+)"/.exec(line);
        if (!ver) continue;
        const v = ver[1].replace(/^[\^~]/, "");
        // A dependency is written `actix-web` and imported `actix_web`.
        // Record BOTH spellings: the panel shows the Cargo name, the
        // index looks the tool up by its crate root.
        versions.set(cargoName.toLowerCase(), v);
        versions.set(cargoName.toLowerCase().replace(/-/g, "_"), v);
      }
    }
    for (const c of CONFIG_TOOLS) {
      if (c.match.test(name)) configs.push({ tool: c.tool, role: c.role, file: name });
    }
  }
  return { versions, declared, configs };
}

// ── the index ────────────────────────────────────────────────────────

function roleRank(r: StackRole): number {
  const i = ROLE_ORDER.indexOf(r);
  return i === -1 ? ROLE_ORDER.length : i;
}

/** Deterministic order: project funnels first (they are the answer to
 *  "what does this project actually use"), then by role, then by name. */
function sortTools(a: StackTool, b: StackTool): number {
  const oa = a.origin === "project" ? 0 : 1;
  const ob = b.origin === "project" ? 0 : 1;
  if (oa !== ob) return oa - ob;
  const ra = roleRank(a.role);
  const rb = roleRank(b.role);
  if (ra !== rb) return ra - rb;
  return a.tool.localeCompare(b.tool);
}

export function buildStackIndex(env: StackEnvelopeLike, projectRoot?: string): StackIndex {
  const { observations, imports, projectSpecs } = collect(env);
  const manifests = readManifests(projectRoot);
  const tools = new Map<string, StackTool>();

  const upsert = (
    tool: string, role: StackRole, origin: StackOrigin, ev: StackEvidence, wraps?: string[],
    statedBy?: string, statedSource?: ConstraintSource,
  ): void => {
    if (!isSafeToolName(tool)) return;
    const key = `${tool} ${role}`;
    let t = tools.get(key);
    if (!t) {
      t = { tool, role, origin, files: [], threads: [], evidence: [] };
      const v = manifests.versions.get(tool.toLowerCase());
      if (v) t.version = v;
      if (wraps) t.wraps = [...wraps];
      // M-CMD.2 — provenance for a role a person supplied. Absent = a table.
      if (statedBy) { t.roleSource = "stated"; t.roleStatedBy = statedBy; if (statedSource) t.roleStatedSource = statedSource; }
      tools.set(key, t);
    } else if (wraps) {
      t.wraps = [...new Set([...(t.wraps ?? []), ...wraps])].sort();
    }
    if (!t.files.includes(ev.file)) t.files.push(ev.file);
    t.evidence.push(ev);
  };

  // M-CMD.2 — STATED roles. A table can only ever name public tools; a
  // private platform SDK (the case on a real codebase: `@tdxvolt/*`, the
  // transport, identity layer and policy boundary of the whole system, all
  // `unknown`) is known to exactly one party, the person who runs it, and
  // the constraint store is where that person already states facts about
  // tools. A stack-policy's `role` therefore classifies the tool it names —
  // ONLY where the table has no answer (a table role is derived evidence;
  // where the two disagree, `stackConflicts` is the place to say so), with
  // the constraint's id carried as provenance onto the record, the spec, and
  // every boundary attributed to it. Never guessed: no policy, no role.
  // M-CMD.3 — PRECEDENCE by source: a human's statement outranks the
  // orchestrator's, which outranks a model's classification (the `classify`
  // pass writes agent-stated `describe` policies), whatever the file order.
  // Within one source the first stated wins, as before.
  const SOURCE_RANK: Record<ConstraintSource, number> = { human: 0, orchestrator: 1, agent: 2 };
  const statedRoles = new Map<string, { role: StackRole; id: string; source: ConstraintSource }>();
  if (projectRoot) {
    for (const c of loadConstraints(projectRoot)) {
      const tool = c.policy?.tool;
      const role = c.policy?.role;
      if (c.kind !== "stack-policy" || !tool || !role) continue;
      const have = statedRoles.get(tool);
      if (have && SOURCE_RANK[have.source] <= SOURCE_RANK[c.source]) continue;
      statedRoles.set(tool, { role, id: c.id, source: c.source });
    }
  }
  const withStated = (tool: string, role: StackRole): { role: StackRole; statedBy?: string; statedSource?: ConstraintSource } => {
    if (role !== "unknown") return { role };
    const s = statedRoles.get(tool);
    return s ? { role: s.role, statedBy: s.id, statedSource: s.source } : { role };
  };

  for (const o of observations) {
    const c = classifyTool(o.language, o.tool);
    const { role, statedBy, statedSource } = withStated(o.tool, c.role);
    upsert(o.tool, role, c.origin, { file: o.file, nodeId: o.nodeId, line: o.line, kind: o.kind }, undefined, statedBy, statedSource);
  }

  // Config-only facts (M-LANG3: .js/.jsx are not parsed, so for an
  // unparsed web frontend these are the ONLY facts — labelled as config).
  for (const c of manifests.configs) {
    upsert(c.tool, c.role, "third-party", { file: c.file, kind: "config" });
  }
  for (const d of manifests.declared) {
    const c = classifyTool("jsts", d.tool);
    const { role, statedBy, statedSource } = withStated(d.tool, c.role);
    if (role === "unknown") continue; // a declared dep nothing imports and no table (or person) knows says nothing
    upsert(d.tool, role, c.origin, { file: d.file, kind: "config" }, undefined, statedBy, statedSource);
  }

  // ── project funnels (the proxy case) ───────────────────────────────
  // A project module that imports a roled tool and that other project
  // files reach IS a tool: the wrapper is the funnel, the import graph is
  // its evidence.
  const importedBy = new Map<string, string[]>();
  for (const [from, tos] of imports) {
    for (const to of tos) {
      if (!importedBy.has(to)) importedBy.set(to, []);
      importedBy.get(to)!.push(from);
    }
  }
  const byFileTools = new Map<string, StackTool[]>();
  for (const t of tools.values()) {
    for (const f of t.files) {
      if (!byFileTools.has(f)) byFileTools.set(f, []);
      byFileTools.get(f)!.push(t);
    }
  }
  const projectTools: StackTool[] = [];
  for (const [file, ir] of Object.entries(env.files)) {
    const importers = [...new Set(importedBy.get(file) ?? [])].sort();
    if (importers.length < WRAPPER_MIN_IMPORTERS) continue;
    const wrapped = (byFileTools.get(file) ?? []).filter((t) => t.origin !== "project" && WRAPPABLE.has(t.role));
    if (wrapped.length === 0) continue;
    // M-LANG1 lets a frontend use the project-relative PATH as its module
    // identity, so a non-Python funnel would be named `gateway/api_client.ts`
    // beside Python's `telemetry.storage`. Give every funnel the same dotted
    // shape — it is a name in prompts, policies and panels. (Surfaced by
    // M-BOUNDARY.1: `fetch` becoming a fact made the gateway's HTTP wrapper
    // the first non-Python funnel these fixtures ever had.)
    const mp = typeof ir.modulePath === "string" ? ir.modulePath : "";
    const pathShaped = mp.includes("/") || /\.(py|ts|tsx|mjs|cjs|js|sh|cpp|cc|cxx|h|hpp|hh)$/.test(mp);
    const name = mp && !pathShaped
      ? mp
      : (mp || file).replace(/\.[^./]+$/, "").split("/").join(".");
    const byRole = new Map<StackRole, StackTool[]>();
    for (const w of wrapped) {
      if (!byRole.has(w.role)) byRole.set(w.role, []);
      byRole.get(w.role)!.push(w);
    }
    for (const [role, list] of byRole) {
      const evidence: StackEvidence[] = [];
      for (const w of list) for (const e of w.evidence) if (e.file === file) evidence.push(e);
      for (const imp of importers) evidence.push({ file: imp, kind: "import" });
      projectTools.push({
        tool: name, role, origin: "project",
        wraps: [...new Set(list.map((w) => w.tool))].sort(),
        // M-BOUNDARY.1 — `home` is the funnel itself; `files` also lists the
        // importers that reach it.
        home: file,
        files: [...new Set([file, ...importers])].sort(),
        threads: [],
        evidence,
      });
    }
  }
  for (const t of projectTools) tools.set(`${t.tool} ${t.role}`, t);

  // ── byFile / byThread ──────────────────────────────────────────────
  const all = [...tools.values()].sort(sortTools);
  const byFile: Record<string, string[]> = {};
  for (const t of all) {
    for (const f of t.files) {
      (byFile[f] ??= []).push(t.tool);
    }
  }
  for (const f of Object.keys(byFile)) byFile[f] = [...new Set(byFile[f])];

  const byThread: Record<string, string[]> = {};
  const threadsOf = new Map<string, Set<string>>();
  for (const th of env.threads ?? []) {
    const ep = th.entryPointId;
    if (!ep) continue;
    const names: string[] = [];
    for (const f of th.filesReached ?? []) for (const n of byFile[f] ?? []) names.push(n);
    byThread[ep] = [...new Set(names)];
    for (const n of byThread[ep]) {
      if (!threadsOf.has(n)) threadsOf.set(n, new Set());
      threadsOf.get(n)!.add(ep);
    }
  }
  for (const t of all) t.threads = [...(threadsOf.get(t.tool) ?? [])].sort();

  // ── M-BOUNDARY.1 — import bindings per file ─────────────────────────
  // One resolution code path: `collect` already decided which specifiers
  // point inside the project, so the bindings inherit that answer rather
  // than re-implementing it.
  const importsByFile: Record<string, ImportBinding[]> = {};
  const localsByFile: Record<string, LocalBinding[]> = {};
  for (const [file, ir] of Object.entries(env.files)) {
    const lang = languageForPath(file)?.id ?? (typeof ir.language === "string" ? ir.language : "");
    if (!lang) continue;
    const bindings = importBindings(ir.nodes ?? [], lang, (spec) => projectSpecs.has(`${file}|${spec}`));
    if (bindings.length) importsByFile[file] = bindings;
    // M-RESOLVE - the assignments, projected. Same shape, same purpose:
    // one place decides what a receiver name refers to.
    const locals = localBindings(ir.nodes ?? []);
    if (locals.length) localsByFile[file] = locals;
  }

  // ── M-BOUNDARY.2 — called vs present ────────────────────────────────
  // `byThread` is PRESENCE (a tool imported anywhere in the files this
  // thread reaches). This is USE: a boundary of the thread attributes to
  // the tool. Present ⊇ called, and the difference is worth seeing — a tool
  // present but never called is a dead dependency or a resolution gap.
  const ownersOf = new Map<string, string[]>();
  for (const [file, ir] of Object.entries(env.files)) {
    for (const n of ir.nodes ?? []) {
      const id = n?.id;
      if (typeof id !== "string") continue;
      const list = ownersOf.get(id);
      if (list) list.push(file); else ownersOf.set(id, [file]);
    }
  }
  const index: StackIndex = { tools: all, byFile, byThread, importsByFile, localsByFile };
  const byThreadCalled: Record<string, string[]> = {};
  const calledOn = new Map<string, Set<string>>();
  let anyThreadNodes = false;
  for (const th of env.threads ?? []) {
    const ep = th.entryPointId;
    if (!ep || !th.nodes) continue;
    anyThreadNodes = true;
    const reached = th.filesReached ?? [];
    const names = new Set<string>();
    for (const n of th.nodes) {
      if (!n || !TERMINAL_KINDS.has(n.kind ?? "")) continue;
      const owners = n.irNodeId ? ownersOf.get(n.irNodeId) ?? [] : [];
      const file = n.file ?? owners.find((f) => reached.includes(f)) ?? owners[0] ?? null;
      const lang = (file ? languageForPath(file)?.id : null) ?? "";
      const a = attributeBoundary({
        language: lang,
        label: n.label ?? "",
        kind: (n.kind as "external" | "dynamic" | "unresolved"),
        qualifiedTarget: n.qualifiedTarget ?? null,
        effectKind: n.effectKind ?? null,
        file,
        irNodeId: n.irNodeId ?? null,
        imports: file ? importsByFile[file] ?? [] : [],
        locals: file ? localsByFile[file] ?? [] : [],
        stack: index,
      });
      if (!a || a.how === "builtin" || a.projectModule) continue;
      names.add(a.tool);
      if (a.via) names.add(a.via);
    }
    byThreadCalled[ep] = [...names].sort();
    for (const n of names) {
      if (!calledOn.has(n)) calledOn.set(n, new Set());
      calledOn.get(n)!.add(ep);
    }
  }
  if (anyThreadNodes) {
    for (const t of all) t.calledOn = [...(calledOn.get(t.tool) ?? [])].sort();
    index.byThreadCalled = byThreadCalled;
  }

  return index;
}

// ── M-STACK.5 — what a packet's edit ADDED ───────────────────────────
// The cheap, exact check the M-ORCH.4 limit named: an import is a node,
// a policy is bound to a tool, so "did this edit reach for a forbidden
// tool" is a lookup, not a judgement.
//
// M-BOUNDARY.3 — an import is where a tool ENTERS a file; the call is
// where it is USED, and that is what a policy is really about. The check
// now reads both: added import nodes through the index's evidence, and
// added CALL nodes through boundary attribution over the file's post-edit
// IR (so an import the same edit added counts, and so does a call added
// to a file that already imported the tool — which the evidence map alone
// could never see).

/** Node types that introduce a tool, across the four frontends. */
const TOOL_NODE_TYPES = new Set(["import", "import_from", "call"]);
/** Node types whose callee makes them a boundary: a bare call, the far
 *  commoner call-valued assignment, and the statement forms that carry a
 *  `callTarget` (return / raise). */
const CALL_NODE_TYPES = new Set(["call", "assignment", "return_stmt", "raise_stmt"]);

export interface AddedTool {
  tool: string;
  role: StackRole;
  origin: StackOrigin;
  file: string;
  nodeId: string;
  /** M-BOUNDARY.3 — whether the edit IMPORTED the tool into the file or
   *  CALLED it. A reject that names the call is actionable; one that names
   *  only the file sends the worker looking. */
  site?: "import" | "call";
  /** The literal call text, for a `call` site. */
  preview?: string;
  /** The project funnel the call lives inside, when it does. */
  via?: string;
  /** True when the tool also has evidence OUTSIDE the files this packet
   *  changed — i.e. the project already used it. False = new here. */
  alsoElsewhere: boolean;
}

/**
 * The tools introduced by an edit, read from the IR delta's NEW nodes
 * against the POST-edit index (which already carries them, so no
 * resolution logic is duplicated). `changedFiles` is the packet's diff
 * set — a tool with evidence outside it is not new to the project.
 */
export function toolsAddedByDelta(
  index: StackIndex,
  deltas: Array<{ file?: string; delta?: unknown }>,
  changedFiles: string[],
  /** M-BOUNDARY.3 - the POST-edit IR of the changed files. With it an added
   *  CALL is attributed the way a thread boundary is; without it the check
   *  falls back to added IMPORTS alone (the M-STACK.5 shape). */
  afterFiles?: Record<string, { nodes?: any[]; language?: string }>,
): AddedTool[] {
  const bySite = new Map<string, StackTool>();
  for (const t of index.tools) {
    if (t.origin === "project") continue; // a funnel is not "a tool added"
    for (const e of t.evidence) {
      if (e.nodeId) bySite.set(`${e.file} ${e.nodeId}`, t);
    }
  }
  const changed = new Set(changedFiles);
  const out: AddedTool[] = [];
  const seen = new Set<string>();
  const push = (a: AddedTool): void => {
    const key = `${a.tool} ${a.file} ${a.nodeId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };
  // Bindings from the POST-edit IR, so an import THIS edit added is
  // available to attribute the call it was added for.
  const bindingsFor = (file: string): ImportBinding[] => {
    const ir = afterFiles?.[file];
    if (!ir?.nodes) return index.importsByFile?.[file] ?? [];
    const lang = languageForPath(file)?.id ?? ir.language ?? "";
    if (!lang) return [];
    // A fresh post-edit IR is not in the index, so project knowledge has
    // to come from the IR itself — otherwise a Rust `use <own crate>::…`
    // added by an edit reads as a new third-party dependency.
    const crate = typeof (ir as any).crateName === "string" ? (ir as any).crateName : null;
    return importBindings(ir.nodes, lang, (spec) => isOwnCrateSpec(lang, spec, crate));
  };
  for (const d of deltas) {
    const file = typeof d.file === "string" ? d.file : "";
    const added = (d.delta as { nodesAdded?: Array<{ id?: string; type?: string }> } | undefined)?.nodesAdded ?? [];
    const nodesById = new Map<string, any>();
    for (const n of afterFiles?.[file]?.nodes ?? []) if (typeof n?.id === "string") nodesById.set(n.id, n);
    for (const n of added) {
      if (!file || !n?.id) continue;
      // (a) the tool ENTERS the file: an import node the index already keyed.
      if (TOOL_NODE_TYPES.has(n.type ?? "")) {
        const t = bySite.get(`${file} ${n.id}`);
        if (t) {
          push({
            tool: t.tool, role: t.role, origin: t.origin, file, nodeId: n.id,
            site: n.type === "call" ? "call" : "import",
            alsoElsewhere: t.files.some((f) => !changed.has(f)),
          });
          continue;
        }
      }
      // (b) the tool is USED: attribute the added call the way a thread
      //     boundary is attributed. This is the case the evidence map
      //     cannot see - a call added to a file that ALREADY imports the
      //     tool introduces no import node, so the old reading found
      //     nothing "introduced" while the policy was plainly broken.
      const ir = nodesById.get(n.id);
      if (!ir || !CALL_NODE_TYPES.has(String(n.type ?? ir.type ?? ""))) continue;
      const callee = typeof ir.funcName === "string" ? ir.funcName
        : typeof ir.callTarget === "string" ? ir.callTarget : "";
      if (!callee) continue;
      const a = attributeBoundary({
        language: languageForPath(file)?.id ?? "",
        label: callee,
        kind: "external",
        qualifiedTarget: null,
        effectKind: typeof ir.effectKind === "string" ? ir.effectKind : null,
        file,
        irNodeId: n.id,
        imports: bindingsFor(file),
        stack: index,
      });
      // A funnel or project code is not "a tool this edit reached for".
      if (!a || a.how === "builtin" || a.projectModule || a.origin === "project") continue;
      const known = index.tools.find((t) => t.tool === a.tool);
      push({
        tool: a.tool, role: a.role as StackRole, origin: a.origin as StackOrigin, file, nodeId: n.id,
        site: "call",
        ...(typeof ir.preview === "string" && ir.preview ? { preview: ir.preview } : {}),
        ...(a.via ? { via: a.via } : {}),
        alsoElsewhere: (known?.files ?? []).some((f) => !changed.has(f)),
      });
    }
  }
  return out;
}

/** The tools a file uses, in the index's order (project funnels first). */
export function stackForFile(index: StackIndex, file: string): StackTool[] {
  const names = new Set(index.byFile[file] ?? []);
  return index.tools.filter((t) => names.has(t.tool) && t.files.includes(file));
}

/** The `stackFor` injection `computeThreadContract` takes: one file's
 *  tools with the evidence count IN THAT FILE (structurally the contract's
 *  ContractStackEntry — kept structural so the contract stays free of a
 *  server-module import). */
export function contractStackForFile(index: StackIndex, file: string): Array<{
  tool: string; role: string; origin: string; evidence: number; wraps?: string[];
}> {
  return stackForFile(index, file).map((t) => ({
    tool: t.tool, role: t.role, origin: t.origin,
    evidence: t.evidence.filter((e) => e.file === file).length,
    ...(t.wraps?.length ? { wraps: t.wraps } : {}),
  }));
}

/** The tools one thread's files use, project funnels first, deduped.
 *  PRESENCE — see `stackCalledOnThread` for use. */
export function stackForThread(index: StackIndex, entryPointId: string): StackTool[] {
  const names = new Set(index.byThread[entryPointId] ?? []);
  return index.tools.filter((t) => names.has(t.tool));
}

/** M-BOUNDARY.2 — the tools a BOUNDARY of this thread actually reaches, a
 *  subset of `stackForThread`. Empty when the index was built without
 *  thread nodes (the question was never asked, which is not the same as
 *  "nothing is called"; `index.byThreadCalled` is absent in that case). */
export function stackCalledOnThread(index: StackIndex, entryPointId: string): StackTool[] {
  const names = new Set(index.byThreadCalled?.[entryPointId] ?? []);
  return index.tools.filter((t) => names.has(t.tool));
}
