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
//   declared  `.env.example` lines and compose `environment:` entries, as
//             infra_manifests.ts reads them (passed in: this module does no I/O).
//
// Never guessed: a name built at runtime is not a name; a bash variable some
// project script ASSIGNS is set by that script (a sourced file), not by the
// environment, and is said apart.

export interface EnvRead { name: string; file: string; line: number; form: string; fnId: string | null }
export interface EnvDeclaration { name: string; file: string; line: number }
export interface EnvVar {
  name: string;
  readers: EnvRead[];
  threads: string[];
  declared: EnvDeclaration[];
  /** bash only: project scripts that ASSIGN this name (it is sourced, not inherited). */
  setBy: string[];
}
export interface EnvSurface {
  vars: EnvVar[];
  /** read by the code, set by no project script, declared nowhere. */
  undeclared: string[];
  /** declared, and read by nothing the IR sees. */
  unread: EnvDeclaration[];
  /** entry point id → the names its thread reads (sorted). */
  byThread: Record<string, string[]>;
  /** false when the project has no .env.example / compose environment at all. */
  hasDeclarations: boolean;
}

interface IrNodeLike { id?: string; type?: string; name?: string; line?: number; endLine?: number; funcName?: string; args?: unknown[] }
interface IrLike { language?: string; nodes?: IrNodeLike[]; envReads?: Array<{ name?: unknown; line?: unknown; form?: unknown }> }
interface ThreadLike { entryPointId?: string | null; nodes: ReadonlyArray<{ kind?: string; file?: string | null; irNodeId?: string | null }>; filesReached?: ReadonlyArray<string> }

const GETENV_CALLS = new Set(["getenv", "std::getenv", "env::var", "std::env::var", "env::var_os", "std::env::var_os"]);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
    out.push({ name, file, line, form: typeof r.form === "string" ? r.form : "read", fnId: enclosingFn(fns, line) });
  }
  for (const n of ir.nodes ?? []) {
    if (n.type !== "call" || !GETENV_CALLS.has(String(n.funcName ?? ""))) continue;
    const name = literalArg(n.args?.[0]);
    if (name) out.push({ name, file, line: n.line ?? 0, form: "call", fnId: enclosingFn(fns, n.line ?? 0) });
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
      name: r.name, readers: [], threads: [], declared: declaredBy.get(r.name) ?? [], setBy: [],
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
    v.threads.sort();
    for (const ep of v.threads) (byThread[ep] ??= []).push(v.name);
  }
  for (const k of Object.keys(byThread)) byThread[k] = [...new Set(byThread[k])].sort();
  const readNames = new Set(vars.map((v) => v.name));
  return {
    vars,
    undeclared: declarations.length ? vars.filter((v) => !v.declared.length).map((v) => v.name) : [],
    unread: declarations.filter((d) => !readNames.has(d.name)),
    byThread,
    hasDeclarations: declarations.length > 0,
  };
}

/** What one thread's contract carries: its names, and which are undeclared. */
export interface ConfiguredBy { names: string[]; undeclared: string[]; hasDeclarations: boolean }

export function configuredByFor(surface: EnvSurface, entryPointId: string): ConfiguredBy {
  const names = surface.byThread[entryPointId] ?? [];
  const undeclared = new Set(surface.undeclared);
  return { names, undeclared: names.filter((n) => undeclared.has(n)), hasDeclarations: surface.hasDeclarations };
}

/** The contract's line. `undefined` (no surface injected) → no line at all. */
export function formatConfiguredBy(c: ConfiguredBy | undefined): string | null {
  if (!c) return null;
  if (!c.names.length) return "Configured by: no environment variable the IR sees.";
  const undeclared = new Set(c.undeclared);
  const marked = c.names.map((n) => (undeclared.has(n) ? `\`${n}\` (NOT declared)` : `\`${n}\``));
  return `Configured by: ${marked.join(", ")}.${c.hasDeclarations ? "" : " (the project declares no environment: no .env.example or compose environment was found)"}`;
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

/** configuration.md — the whole surface, for a reader or an agent. */
export function formatEnvSurfaceMd(s: EnvSurface): string {
  const lines = [
    "# Configuration (derived — the environment variables the code reads)",
    "",
    `${s.vars.length} variable(s) are read by name. A read is \`process.env.X\`, \`import.meta.env.X\`, \`os.environ["X"]\`, \`getenv("X")\`, \`env::var("X")\`, or an UPPERCASE \`$X\` a bash script expands and never assigns. A name built at runtime is not a name and is not here. Declarations come from \`.env.example\` and compose \`environment:\` entries.`,
    "",
  ];
  if (s.hasDeclarations) {
    lines.push(`## Read, but declared nowhere (${s.undeclared.length})`, "",
      s.undeclared.length
        ? "A deploy that sets only what `.env.example` lists will run these with the variable unset. Declare each, or confirm the code has a default."
        : "None: every variable the code reads is declared.", "",
      ...s.undeclared.map((n) => `- \`${n}\` — read in ${s.vars.find((v) => v.name === n)!.readers.map((r) => `\`${r.file}:${r.line}\``).slice(0, 4).join(", ")}`), "",
      `## Declared, but read by nothing the IR sees (${s.unread.length})`, "",
      s.unread.length ? "Possibly stale — or read in a way the IR cannot name (a computed key, a config library), or read by a TOOL rather than by project code (marked)." : "None.", "",
      ...s.unread.map((d) => `- \`${d.name}\` — ${d.file}:${d.line}${toolThatReads(d.name) ? ` (read by ${toolThatReads(d.name)} itself: expected)` : ""}`), "");
  } else {
    lines.push("The project declares no environment (no `.env.example`, no compose `environment:`), so nothing can be checked against a declaration.", "");
  }
  lines.push("## Every variable", "", "| variable | declared | read in | threads |", "|---|---|---|---|");
  for (const v of s.vars) {
    const decl = v.declared.length ? v.declared.map((d) => `${d.file}:${d.line}`).join(", ") : s.hasDeclarations ? "**no**" : "—";
    const files = [...new Set(v.readers.map((r) => r.file))];
    lines.push(`| \`${v.name}\` | ${decl} | ${files.slice(0, 3).map((f) => `\`${f}\``).join(", ")}${files.length > 3 ? ` +${files.length - 3}` : ""} | ${v.threads.length} |`);
  }
  return lines.join("\n") + "\n";
}
