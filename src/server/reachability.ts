// Reachability (2026-09-28) — the functions no discovered entry point reaches.
//
// A thread is everything one entry point can reach, so the union of every
// thread is what the project is known to RUN. A function on no thread is not
// therefore dead: the report says WHY each one is unreached, strongest reason
// first, and never calls anything dead that the IR merely failed to follow.
//
//   never-named                the name appears in no call, argument,
//                              preview or import anywhere in the project;
//   exported-never-named       the same, but exported — a package API, a
//                              framework convention or a dynamic import may
//                              still use it;
//   called-only-from-unreached every call the linker resolved to it sits in
//                              code that is itself unreached;
//   named-not-linked           its name IS written somewhere (a handler passed
//                              by name, a chained call, a JSX tag the linker
//                              did not bind) — a RESOLUTION GAP, not dead code;
//   walk-gap-nested            declared inside a function a thread DOES reach,
//                              and called there — the thread walk does not
//                              follow a locally declared helper yet. A limit
//                              of VibeGraph, said as one.
//
// Why it exists: measured against codegraph on a private production codebase (reviews, 2026-09-28)
// a call index reports "2 callers" for a browser → Volt path that no page
// renders at all; reachability from entry points is what says so.
//
// Test files are left out — every function in one is a test or a fixture. A
// test is found by its entry point or by naming convention.

//   framework-callback         a method its BASE class calls — `handle_starttag`
//                              on an HTMLParser subclass, `visit_Name` on an
//                              ast.NodeVisitor (2026-10-07, field report: they
//                              were listed as the strongest dead-code
//                              candidates). The table is FRAMEWORK_CALLBACKS.
//
// 2026-10-07 — "never named" is a claim about the SOURCE, and node previews are
// cut at ~80 characters: the functions in a long dispatch table
// (`{"rows": "jobs", "parse": _row_jobs}`, many lines) were never in any
// preview. Given the project root, a name the IR did not see is looked for in
// the source text before it is called never named.

import * as fs from "fs";
import * as path from "path";

export type UnreachedReason =
  | "never-named" | "exported-never-named" | "called-only-from-unreached"
  | "named-not-linked" | "walk-gap-nested" | "framework-callback";

/** Base class (last dotted segment) → the methods the framework calls on a subclass. */
export const FRAMEWORK_CALLBACKS: Record<string, RegExp> = {
  HTMLParser: /^(handle_\w+|unknown_decl|error|reset|close)$/,
  TestCase: /^(setUp|tearDown|setUpClass|tearDownClass|asyncSetUp|asyncTearDown|test\w*|run|debug)$/,
  IsolatedAsyncioTestCase: /^(asyncSetUp|asyncTearDown|setUp|tearDown|test\w*)$/,
  JSONEncoder: /^(default|encode|iterencode)$/,
  JSONDecoder: /^(decode|raw_decode)$/,
  NodeVisitor: /^(visit\w*|generic_visit)$/,
  NodeTransformer: /^(visit\w*|generic_visit)$/,
  BaseRequestHandler: /^(handle|setup|finish)$/,
  StreamRequestHandler: /^(handle|setup|finish)$/,
  DatagramRequestHandler: /^(handle|setup|finish)$/,
  BaseHTTPRequestHandler: /^(do_[A-Z]+|log_message|log_request|log_error|handle\w*|send_\w+|end_headers)$/,
  SimpleHTTPRequestHandler: /^(do_[A-Z]+|log_message|log_request|log_error|list_directory|translate_path|send_head|end_headers)$/,
  Handler: /^(emit|handle|format|flush|close|createLock|acquire|release|filter)$/,
  StreamHandler: /^(emit|handle|format|flush|close)$/,
  FileHandler: /^(emit|handle|format|flush|close)$/,
  Formatter: /^(format\w*|usesTime|converter)$/,
  Filter: /^filter$/,
  Thread: /^run$/,
  Process: /^run$/,
  Cmd: /^(do_\w+|help_\w+|complete_\w+|default|emptyline|precmd|postcmd|preloop|postloop|onecmd|completedefault)$/,
  Action: /^(__call__|format_usage)$/,
  ArgumentParser: /^(error|exit|format_\w+|print_\w+|parse_\w+|convert_arg_line_to_args)$/,
  Enum: /^(_generate_next_value_|_missing_)$/,
  Exception: /^(__str__|__repr__|__reduce__)$/,
  ContextDecorator: /^(__enter__|__exit__)$/,
  Protocol: /^\w+$/,
};
/** A dunder the language itself calls (`__repr__`, `__iter__`, `__enter__`…) on any class. */
const DUNDER = /^__\w+__$/;

export const FRAMEWORK_CALLBACK_REASON = "called by its base class";

export interface UnreachedDef { file: string; id: string; name: string; line: number; reason: UnreachedReason; callers: number }

export interface Reachability {
  /** function definitions outside test files. */
  defs: number;
  reached: number;
  testFilesSkipped: number;
  unreached: UnreachedDef[];
  /** files that define functions, none of which any thread reaches. */
  filesUnreached: Array<{ file: string; defs: number }>;
  counts: Record<UnreachedReason, number>;
}

interface IrNode { id: string; type?: string; name?: string; line?: number; parentId?: string | null;
  isExported?: boolean; isDefaultExport?: boolean; funcName?: string; preview?: string; callTarget?: string;
  args?: unknown[]; names?: unknown[]; bases?: unknown[]; literals?: unknown[] }
interface IrEdge { type?: string; source: string; target: string; targetFile?: string }
interface EnvLike {
  files: Record<string, { nodes?: IrNode[]; edges?: IrEdge[] }>;
  threads: ReadonlyArray<{ nodes: ReadonlyArray<{ file?: string | null; irNodeId?: string | null }> }>;
  entryPoints: ReadonlyArray<{ file: string; irNodeId: string; kind?: string }>;
}

export const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|(^|\/)test_[^/]*$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$/;

const WORD = /[A-Za-z_$][\w$]*/g;

/** Source minus block docstrings and comments (`"""…"""`, `'''…'''`, `/* … *\/`,
 *  `# …` and `// …` to the end of the line). Approximate on purpose: a `#`
 *  inside a string loses the rest of that line, which can only make a name
 *  look LESS used, never invent a use. */
export function withoutCommentary(src: string): string {
  return src
    .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\w"'])\/\/[^\n]*/g, "$1")
    .replace(/(^|\s)#[^\n!][^\n]*/g, "$1");
}

/** The source text, for the names the IR's previews did not carry. */
function sourceNameCounter(root: string | undefined, files: string[]): ((name: string) => number) | null {
  if (!root) return null;
  let texts: string[] | null = null;
  const counts = new Map<string, number>();
  return (name) => {
    if (counts.has(name)) return counts.get(name)!;
    // a comment or a docstring that mentions a name ("`old` is named nowhere")
    // is not a use; a one-line string can be (`getattr(mod, "name")`), so it stays
    texts ??= files.map((f) => { try { return withoutCommentary(fs.readFileSync(path.join(root, f), "utf-8")); } catch { return ""; } });
    const re = new RegExp(`(?<![\\w$])${name.replace(/[$]/g, "\\$")}(?![\\w$])`, "g");
    let n = 0;
    for (const t of texts) n += (t.match(re) ?? []).length;
    counts.set(name, n);
    return n;
  };
}

function frameworkCallback(name: string, klass: IrNode | undefined): boolean {
  if (!klass) return false;
  // a constructor is reached through its class's name, not called back
  if (DUNDER.test(name) && name !== "__init__" && name !== "__new__") return true;
  for (const b of klass.bases ?? []) {
    const base = String(b).replace(/\[.*$/, "").split(".").pop() ?? "";
    if (FRAMEWORK_CALLBACKS[base]?.test(name)) return true;
  }
  return false;
}

export function computeReachability(env: EnvLike, opts: { root?: string } = {}): Reachability {
  const reached = new Set<string>();
  for (const t of env.threads) for (const n of t.nodes) if (n.file && n.irNodeId) reached.add(`${n.file}::${n.irNodeId}`);
  for (const e of env.entryPoints) reached.add(`${e.file}::${e.irNodeId}`);
  const testFiles = new Set(env.entryPoints.filter((e) => e.kind === "test").map((e) => e.file));
  const isTest = (f: string) => testFiles.has(f) || TEST_FILE.test(f);

  // Resolved calls, keyed by the definition they reach; and every identifier
  // written anywhere a name can be USED (not where it is defined).
  const callers = new Map<string, string[]>();
  const named = new Set<string>();
  const defsNamed = new Map<string, number>();
  for (const [file, ir] of Object.entries(env.files)) {
    for (const e of ir.edges ?? []) {
      if (e.type !== "reference") continue;
      const k = `${e.targetFile ?? file}::${e.target}`;
      (callers.get(k) ?? callers.set(k, []).get(k)!).push(`${file}::${e.source}`);
    }
    for (const n of ir.nodes ?? []) {
      if (n.type === "function_def" || n.type === "class_def") { defsNamed.set(String(n.name ?? ""), (defsNamed.get(String(n.name ?? "")) ?? 0) + 1); continue; }
      const texts = [n.funcName, n.preview, n.callTarget, ...(n.args ?? []), ...(n.names ?? []), ...(n.literals ?? [])];
      for (const s of texts) for (const w of String(s ?? "").match(WORD) ?? []) named.add(w);
    }
  }
  // written more often than it is defined = used somewhere the IR did not
  // spell out (a long literal, a decorator argument, a string-free reference)
  const sourceCount = sourceNameCounter(opts.root, Object.keys(env.files));
  const isNamed = (name: string) => named.has(name) || (!!sourceCount && !!name && sourceCount(name) > (defsNamed.get(name) ?? 1));

  const unreached: UnreachedDef[] = [];
  const filesUnreached: Array<{ file: string; defs: number }> = [];
  let defs = 0, reachedDefs = 0, testFilesSkipped = 0;
  for (const [file, ir] of Object.entries(env.files)) {
    if (isTest(file)) { testFilesSkipped++; continue; }
    const byId = new Map((ir.nodes ?? []).map((n) => [n.id, n]));
    let fileDefs = 0, fileReached = 0;
    for (const n of ir.nodes ?? []) {
      if (n.type !== "function_def") continue;
      defs++; fileDefs++;
      const key = `${file}::${n.id}`;
      if (reached.has(key)) { reachedDefs++; fileReached++; continue; }
      // The nearest enclosing function, and the class a method sits in.
      let p = n.parentId ? byId.get(n.parentId) : undefined;
      let enclosing: IrNode | undefined;
      let klass: IrNode | undefined;
      while (p) {
        if (p.type === "function_def") { enclosing = p; break; }
        if (p.type === "class_def" && !klass) klass = p;
        p = p.parentId ? byId.get(p.parentId) : undefined;
      }
      // Nested in an UNREACHED function: it is counted with that function.
      if (enclosing && !reached.has(`${file}::${enclosing.id}`)) continue;
      const cs = callers.get(key) ?? [];
      const name = String(n.name ?? "");
      // A constructor is reached through its class's name (`new X`, `X()`).
      const useName = (name === "constructor" || name === "__init__") && klass?.name ? String(klass.name) : name;
      const reason: UnreachedReason = enclosing ? "walk-gap-nested"
        : frameworkCallback(name, klass) ? "framework-callback"
        : cs.length ? "called-only-from-unreached"
        : isNamed(useName) ? "named-not-linked"
        : (n.isExported || n.isDefaultExport) ? "exported-never-named"
        : "never-named";
      unreached.push({ file, id: n.id, name, line: n.line ?? 0, reason, callers: cs.length });
    }
    if (fileDefs > 0 && fileReached === 0) filesUnreached.push({ file, defs: fileDefs });
  }
  const counts = { "never-named": 0, "exported-never-named": 0, "called-only-from-unreached": 0, "named-not-linked": 0, "walk-gap-nested": 0, "framework-callback": 0 } as Record<UnreachedReason, number>;
  for (const u of unreached) counts[u.reason]++;
  unreached.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  filesUnreached.sort((a, b) => a.file.localeCompare(b.file));
  return { defs, reached: reachedDefs, testFilesSkipped, unreached, filesUnreached, counts };
}

const SECTION: Array<[UnreachedReason, string, string, string]> = [
  ["never-named", "Never named anywhere", "likely dead",
    "The strongest dead-code candidates: no call, argument, import or JSX tag in the project names them. Check for reflection, a framework convention or an external caller before deleting."],
  ["exported-never-named", "Exported, never named in the project", "dead here; may be used outside",
    "Exported but used nowhere here. Something outside the project (a package consumer, a framework, a dynamic import) may still call it."],
  ["called-only-from-unreached", "Called only from code nothing reaches", "dead with its caller",
    "Live-looking code whose every resolved caller is itself unreached — usually a component or module no page or entry point uses."],
  ["named-not-linked", "Named, but the linker did not link the use", "a resolution gap: treat as used",
    "A RESOLUTION GAP, not dead code: the name is written somewhere (a handler passed by name, a chained call, a tag the linker did not bind). Treat it as used."],
  ["walk-gap-nested", "Helpers nested inside reached functions", "a VibeGraph limit: treat as reached",
    "A LIMIT of VibeGraph, not of the code: declared inside a function a thread reaches and called there, but the thread walk does not follow a locally declared helper yet. Treat it as reached."],
  ["framework-callback", "Framework callbacks", "called by its base class: treat as used",
    "Methods the base class calls on a subclass (HTMLParser's handle_starttag, NodeVisitor's visit_*, a request handler's do_GET) or the language calls (__repr__, __enter__). Not dead: whatever reaches the class reaches them."],
];

/** The report a reader acts on: files first, then each reason in turn. */
export function formatReachabilityMd(r: Reachability): string {
  const lines = [
    "# Reachability (derived — what no discovered entry point reaches)",
    "",
    `A thread is everything one entry point can reach; together the threads are what this project is known to run. ${r.reached} of ${r.defs} functions outside tests are on a thread (${r.testFilesSkipped} test file(s) left out). The rest are listed with the reason they are unreached, strongest first — and only the first two reasons suggest dead code. Unreached is not unused: a function called by reflection, by a framework convention, or from outside the project reads as unreached here.`,
    "",
    "| reason | functions | means |",
    "|---|---|---|",
    ...SECTION.map(([k, title, short]) => `| ${title} | ${r.counts[k]} | ${short} |`),
    "",
    `## Files nothing reaches (${r.filesUnreached.length})`,
    "",
    r.filesUnreached.length
      ? "Every function in these files is unreached. Before changing one, find out who uses it; before deleting one, check the reasons below for each function in it."
      : "None: every file that defines a function has at least one on a thread.",
    "",
    ...r.filesUnreached.map((f) => `- \`${f.file}\` — ${f.defs} function(s)`),
  ];
  for (const [k, title, , means] of SECTION) {
    const list = r.unreached.filter((u) => u.reason === k);
    lines.push("", `## ${title} (${list.length})`, "", means, "");
    if (!list.length) { lines.push("None."); continue; }
    const byFile = new Map<string, UnreachedDef[]>();
    for (const u of list) (byFile.get(u.file) ?? byFile.set(u.file, []).get(u.file)!).push(u);
    // The two "treat it as used" reasons are counted per file, not listed:
    // they are not candidates for anything, and on a real codebase they are
    // most of the report (a private production codebase: 1,087 of 1,907). The full list rides
    // reachability.json with --with-ir.
    const brief = k === "named-not-linked" || k === "walk-gap-nested" || k === "framework-callback";
    for (const [file, us] of byFile) {
      lines.push(brief
        ? `- \`${file}\` — ${us.length}`
        : `- \`${file}\`: ${us.map((u) => `\`${u.name}\` (line ${u.line}${u.callers ? `, ${u.callers} unreached caller(s)` : ""})`).join(", ")}`);
    }
  }
  return lines.join("\n") + "\n";
}
