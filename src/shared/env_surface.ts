// The configuration surface (2026-09-28) — which environment variables the
// code reads, where, on which threads, and whether the project DECLARES them.
//
// From the codebase-memory-mcp comparison on a private production codebase: it keeps env vars as
// graph nodes, and we had nothing — while a thread's behaviour often turns on
// one (`OPENAI_API_KEY`, a feature flag, an orchestrator path). Everything
// here is read from the parse:
//
//   reads     the IR root's `envReads` (a frontend saw `process.env.X`,
//             `os.environ["X"]`, a bash `$X` the script never assigns) plus
//             CALL nodes the IR already has (`getenv("X")`, `env::var("X")`)
//             with a literal first argument;
//   declared  every place that can put a variable in front of running code —
//             env templates, compose, Dockerfile, systemd, pm2, k8s and the
//             deploy workflows (env_declarations.ts reads them; passed in:
//             this module does no I/O).
//
// 2026-10-17, from a field run whose outage was a variable read by the code
// and written by no deploy — present in the old report as one of 224
// "declared nowhere", alphabetical, beside CI secrets that were fine:
//   - each variable says what an UNSET value does (`ifUnset`), from the
//     frontends' `fallback` / `use` facts, and the report ranks by it;
//   - a build-time name (NEXT_PUBLIC_, VITE_ …) is marked: a change needs a
//     rebuild, not a restart;
//   - deploy targets of one kind (two deploy workflows, two compose files)
//     are compared: the bug class is "set on one, missing on the other".
//
// Never guessed: a name built at runtime is not a name; a bash variable some
// project script ASSIGNS is set by that script (a sourced file), not by the
// environment, and is said apart.

import { platformThatProvides } from "./platform_env.ts";

export interface EnvRead {
  name: string; file: string; line: number; form: string; fnId: string | null;
  /** what an unset value becomes here, when the expression says (ir.schema.json envReads) */
  fallback?: "value" | "empty" | "throws";
  use?: "split" | "exit-silent" | "exit-loud";
}
export interface EnvDeclaration { name: string; file: string; line: number; via?: string; from?: "secret" | "var" }
/** What the code does when the variable is not set, worst read first. */
export type UnsetEffect = "silent" | "unset" | "loud" | "defaulted";
export interface EnvVar {
  name: string;
  readers: EnvRead[];
  threads: string[];
  declared: EnvDeclaration[];
  /** bash only: project scripts that ASSIGN this name (it is sourced, not inherited). */
  setBy: string[];
  ifUnset: UnsetEffect;
  /** baked into a bundle at build time (NEXT_PUBLIC_, VITE_ …): a change needs a rebuild */
  buildTime: boolean;
  /** RC8 — set by a platform itself (a CI runner, a host, Claude Code): never undeclared (platform_env.ts) */
  providedBy?: string;
}
/** One kind of deploy target with two or more files, and the variables some set and others do not. */
export interface TargetGap { family: string; targets: string[]; rows: Array<{ name: string; setIn: string[] }> }
export interface EnvSurface {
  vars: EnvVar[];
  /** read by the code, set by no project script or platform, declared nowhere — worst `ifUnset` first. */
  undeclared: string[];
  /** declared, and read by nothing the IR sees. */
  unread: EnvDeclaration[];
  /** entry point id → the names its thread reads (sorted). */
  byThread: Record<string, string[]>;
  /** false when the project declares no environment anywhere it can be read. */
  hasDeclarations: boolean;
  targetGaps: TargetGap[];
}

interface IrNodeLike { id?: string; type?: string; name?: string; line?: number; endLine?: number; funcName?: string; args?: unknown[] }
interface IrLike { language?: string; nodes?: IrNodeLike[]; envReads?: Array<{ name?: unknown; line?: unknown; form?: unknown; fallback?: unknown; use?: unknown }> }
interface ThreadLike { entryPointId?: string | null; nodes: ReadonlyArray<{ kind?: string; file?: string | null; irNodeId?: string | null }>; filesReached?: ReadonlyArray<string> }

const GETENV_CALLS = new Set(["getenv", "std::getenv", "env::var", "std::env::var", "env::var_os", "std::env::var_os"]);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FALLBACKS = new Set(["value", "empty", "throws"]);
const USES = new Set(["split", "exit-silent", "exit-loud"]);
const BUILD_TIME = /^(NEXT_PUBLIC_|VITE_|REACT_APP_|VUE_APP_|NUXT_PUBLIC_|EXPO_PUBLIC_|GATSBY_|PUBLIC_)/;

function literalArg(a: unknown): string | null {
  const m = /^\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*$/.exec(String(a ?? ""));
  return m ? m[1] : null;
}

/** The innermost function_def whose span covers `line`, or null (module level). */
function enclosingFn(fns: IrNodeLike[], line: number): string | null {
  let best: IrNodeLike | null = null;
  for (const f of fns) {
    if (f.line == null || f.endLine == null || f.line > line || f.endLine < line) continue;
    if (!best || (f.endLine - f.line) < ((best.endLine ?? 0) - (best.line ?? 0))) best = f;
  }
  return best?.id ?? null;
}

/** One file's reads, each placed in its function. */
export function envReadsFor(file: string, ir: IrLike): EnvRead[] {
  const fns = (ir.nodes ?? []).filter((n) => n.type === "function_def");
  const out: EnvRead[] = [];
  for (const r of ir.envReads ?? []) {
    const name = typeof r.name === "string" ? r.name : "";
    const line = typeof r.line === "number" ? r.line : 0;
    if (!NAME.test(name)) continue;
    out.push({
      name, file, line, form: typeof r.form === "string" ? r.form : "read", fnId: enclosingFn(fns, line),
      ...(FALLBACKS.has(r.fallback as string) ? { fallback: r.fallback as EnvRead["fallback"] } : {}),
      ...(USES.has(r.use as string) ? { use: r.use as EnvRead["use"] } : {}),
    });
  }
  for (const n of ir.nodes ?? []) {
    if (n.type !== "call" || !GETENV_CALLS.has(String(n.funcName ?? ""))) continue;
    const name = literalArg(n.args?.[0]);
    if (name) out.push({ name, file, line: n.line ?? 0, form: "call", fnId: enclosingFn(fns, n.line ?? 0) });
  }
  return out;
}

const UNSET_ORDER: UnsetEffect[] = ["silent", "unset", "loud", "defaulted"];
/** What one read does with an unset value. Silent = an empty or missing value
 *  split into a list or gating an early return: no error, the feature just
 *  stops (the field run's outage). Loud = it raises or exits. */
export function readEffect(r: Pick<EnvRead, "fallback" | "use">): UnsetEffect {
  if ((r.use === "split" || r.use === "exit-silent") && r.fallback !== "value" && r.fallback !== "throws") return "silent";
  if (r.fallback === "throws" || r.use === "exit-loud") return "loud";
  if (r.fallback === "value") return "defaulted";
  return "unset";
}
const worst = (rs: EnvRead[]): UnsetEffect => UNSET_ORDER[Math.min(...rs.map((r) => UNSET_ORDER.indexOf(readEffect(r))))] ?? "unset";

/** Deploy targets by kind: a workflow is one when it passes or writes
 *  variables onward, or its name says it deploys; an env template is a list,
 *  not a target. */
const FAMILY: Record<string, string> = {
  "workflow-env": "deploy workflows", "workflow-pass": "deploy workflows", "workflow-write": "deploy workflows", "workflow-step": "deploy workflows",
  compose: "compose files", k8s: "k8s manifests", systemd: "systemd units", pm2: "pm2 ecosystems", dockerfile: "Dockerfiles", "build-arg": "Dockerfiles",
};
function targetGaps(vars: EnvVar[], declarations: ReadonlyArray<EnvDeclaration>): TargetGap[] {
  const deploying = new Set(declarations.filter((d) => d.via === "workflow-pass" || d.via === "workflow-write").map((d) => d.file));
  const byFamily = new Map<string, Map<string, Set<string>>>();
  for (const d of declarations) {
    const family = d.via ? FAMILY[d.via] : undefined;
    if (!family) continue;
    if (family === "deploy workflows" && !deploying.has(d.file) && !/deploy|release|publish|prod|staging/i.test(d.file)) continue;
    const files = byFamily.get(family) ?? byFamily.set(family, new Map()).get(family)!;
    (files.get(d.file) ?? files.set(d.file, new Set()).get(d.file)!).add(d.name);
  }
  const out: TargetGap[] = [];
  for (const [family, files] of [...byFamily].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (files.size < 2) continue;
    const targets = [...files.keys()].sort();
    const rows = vars
      .map((v) => ({ name: v.name, setIn: targets.filter((t) => files.get(t)!.has(v.name)) }))
      .filter((r) => r.setIn.length > 0 && r.setIn.length < targets.length);
    if (rows.length) out.push({ family, targets, rows });
  }
  return out;
}

export function buildEnvSurface(
  env: { files: Record<string, IrLike>; threads: ReadonlyArray<ThreadLike> },
  declarations: ReadonlyArray<EnvDeclaration>,
): EnvSurface {
  const reads: EnvRead[] = [];
  const bashAssigns = new Map<string, Set<string>>();
  for (const [file, ir] of Object.entries(env.files)) {
    reads.push(...envReadsFor(file, ir));
    if (ir.language !== "bash") continue;
    for (const n of ir.nodes ?? []) {
      if (n.type === "assignment" && n.name && NAME.test(n.name)) {
        (bashAssigns.get(n.name) ?? bashAssigns.set(n.name, new Set()).get(n.name)!).add(file);
      }
    }
  }
  // Which threads walk each (file, function) — and each file, for module-level reads.
  const threadsAt = new Map<string, Set<string>>();
  const threadsInFile = new Map<string, Set<string>>();
  const byThread: Record<string, string[]> = {};
  for (const t of env.threads) {
    const ep = t.entryPointId;
    if (!ep) continue;
    for (const n of t.nodes) {
      if (!n.file) continue;
      (threadsInFile.get(n.file) ?? threadsInFile.set(n.file, new Set()).get(n.file)!).add(ep);
      if (n.irNodeId && (n.kind === "seed" || n.kind === "step")) {
        const k = `${n.file}::${n.irNodeId}`;
        (threadsAt.get(k) ?? threadsAt.set(k, new Set()).get(k)!).add(ep);
      }
    }
    for (const f of t.filesReached ?? []) (threadsInFile.get(f) ?? threadsInFile.set(f, new Set()).get(f)!).add(ep);
  }
  const declaredBy = new Map<string, EnvDeclaration[]>();
  for (const d of declarations) (declaredBy.get(d.name) ?? declaredBy.set(d.name, []).get(d.name)!).push(d);

  const byName = new Map<string, EnvVar>();
  for (const r of reads) {
    const v = byName.get(r.name) ?? byName.set(r.name, {
      name: r.name, readers: [], threads: [], declared: declaredBy.get(r.name) ?? [], setBy: [], ifUnset: "unset", buildTime: BUILD_TIME.test(r.name),
      ...(platformThatProvides(r.name) ? { providedBy: platformThatProvides(r.name)! } : {}),
    }).get(r.name)!;
    v.readers.push(r);
    // A bash read of a name some project script assigns is SOURCED, not inherited.
    if (r.form === "inherited" && bashAssigns.has(r.name)) v.setBy = [...bashAssigns.get(r.name)!].sort();
    // A read inside a function belongs to the threads that walk that function;
    // a module-level read runs when the file is loaded or run, so it belongs
    // to every thread that reaches the file.
    const eps = r.fnId ? threadsAt.get(`${r.file}::${r.fnId}`) : threadsInFile.get(r.file);
    for (const ep of eps ?? []) if (!v.threads.includes(ep)) v.threads.push(ep);
  }
  // A bash-inherited name that project scripts assign is not configuration.
  const vars = [...byName.values()]
    .filter((v) => !(v.setBy.length && v.readers.every((r) => r.form === "inherited")))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const v of vars) {
    v.ifUnset = worst(v.readers);
    v.threads.sort();
    for (const ep of v.threads) (byThread[ep] ??= []).push(v.name);
  }
  for (const k of Object.keys(byThread)) byThread[k] = [...new Set(byThread[k])].sort();
  const readNames = new Set(vars.map((v) => v.name));
  const rank = (v: EnvVar) => UNSET_ORDER.indexOf(v.ifUnset);
  return {
    vars,
    undeclared: declarations.length ? vars.filter((v) => !v.declared.length && !v.providedBy).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((v) => v.name) : [],
    unread: declarations.filter((d) => !readNames.has(d.name)),
    byThread,
    hasDeclarations: declarations.length > 0,
    targetGaps: targetGaps(vars, declarations),
  };
}

/** What one thread's contract carries: its names, and which are undeclared. */
export interface ConfiguredBy { names: string[]; undeclared: string[]; hasDeclarations: boolean; silent?: string[] }

export function configuredByFor(surface: EnvSurface, entryPointId: string): ConfiguredBy {
  const names = surface.byThread[entryPointId] ?? [];
  const undeclared = new Set(surface.undeclared);
  const silent = names.filter((n) => surface.vars.find((v) => v.name === n)?.ifUnset === "silent");
  return { names, undeclared: names.filter((n) => undeclared.has(n)), hasDeclarations: surface.hasDeclarations, ...(silent.length ? { silent } : {}) };
}

/** The contract's line. `undefined` (no surface injected) → no line at all. */
export function formatConfiguredBy(c: ConfiguredBy | undefined): string | null {
  if (!c) return null;
  if (!c.names.length) return "Configured by: no environment variable the IR sees.";
  const undeclared = new Set(c.undeclared);
  const silent = new Set(c.silent ?? []);
  const marked = c.names.map((n) => {
    const notes = [undeclared.has(n) ? "NOT declared" : "", silent.has(n) ? "fails silently when unset" : ""].filter(Boolean);
    return notes.length ? `\`${n}\` (${notes.join(", ")})` : `\`${n}\``;
  });
  return `Configured by: ${marked.join(", ")}.${c.hasDeclarations ? "" : " (the project declares no environment: no env template, compose, Dockerfile, systemd, pm2, k8s or deploy-workflow declaration was found)"}`;
}

/** Variables a TOOL reads from the environment itself — declaring them is
 *  how a project configures the tool, so "read by no project code" is
 *  expected, not stale. Documented behaviour of each tool, by prefix. */
const TOOL_READ: Array<[RegExp, string]> = [
  [/^PG(HOST|PORT|USER|PASSWORD|DATABASE|SSLMODE|OPTIONS|APPNAME|PASSFILE)$/, "libpq / psql"],
  [/^NODE_(OPTIONS|ENV|EXTRA_CA_CERTS|PATH|TLS_REJECT_UNAUTHORIZED)$/, "Node.js"],
  [/^DOTENV_/, "dotenv"],
  [/^AWS_(REGION|DEFAULT_REGION|PROFILE|ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)$/, "the AWS SDK"],
  [/^(HTTP_PROXY|HTTPS_PROXY|NO_PROXY)$/i, "HTTP clients"],
  [/^PYTHON(PATH|UNBUFFERED|DONTWRITEBYTECODE)$/, "Python"],
];
export function toolThatReads(name: string): string | null {
  for (const [re, tool] of TOOL_READ) if (re.test(name)) return tool;
  return null;
}
