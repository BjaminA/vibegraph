// UNTRUSTED INPUT → DANGEROUS SINK (2026-09-29, Ben: "a data-flow fact, for
// example request input reaches subprocess / SQL without a guard").
//
// A deliberately simple taint pass over the IR every frontend already emits
// — an assignment's target name and value text, each call argument's text,
// a function's parameters, an `if`'s condition, and the linker's reference
// edges from a call to the function it reaches. It follows NAMES:
//
//   SOURCE   request data (request.args / .json / .form …, req.body / .query
//            / .params …, request.json() / formData / searchParams), the
//            parameters of a route or MCP-tool handler, command-line
//            arguments (sys.argv, process.argv, bash $1…$9 / $@ / $*,
//            `read` targets), input().
//   FLOW     a name assigned from an expression that mentions a tainted name
//            (or a source) is tainted; a loop target over a tainted iterable
//            is tainted; a tainted argument taints the callee's parameter
//            it binds to (positional or keyword), across files.
//   CLEANED  a value produced by a type conversion or an escaper (int(),
//            float(), Number(), parseInt(), shlex.quote(), escape…) is not
//            tainted.
//   SINK     command — a shell string (os.system, os.popen, subprocess with
//            shell=True, child_process exec / execSync, eval / sh -c /
//            bash -c in bash, a command word that is a tainted variable);
//            argument — a list-form subprocess / spawn / execFile argument;
//            sql — the QUERY TEXT of execute / executemany / executescript /
//            query / raw / prepare (a value passed as a separate parameter
//            is parameterised, and is NOT a finding); code — eval / exec /
//            new Function.
//   GUARD    an `if` condition between source and sink that mentions the
//            value, or (2026-10-17, from a field run where a script's
//            `guard_rel_script "$REL"` sat 44 lines above its exec) a call
//            written at or before the sink to a guard-named function
//            (guard* / validate* / verify* / assert* / ensure* / check_* /
//            is_valid* …) that takes the value or the value it came from:
//            reported as "guarded — verify the check", never as safe.
//
// What it CANNOT see, stated on every report: it is name-based and
// flow-insensitive (the order of statements is not modelled — it may flag a
// value re-assigned from a clean source first); a value stored in an object
// attribute or a container element and read back is not followed; dynamic
// dispatch and unresolved calls are not followed; a guard is a condition
// that mentions the value, not a proof that it validates. A finding is a
// place to look, and the absence of findings is not a clean bill.
//
// Pure: files in, findings out.

import { languageById, languageForPath } from "../shared/languages.ts";
import { boundNames, callsInText, codeOf, mentions, type Lang } from "./dataflow_text.ts";
export { boundNames, callsInText, codeOf } from "./dataflow_text.ts";

export type SinkKind = "command" | "argument" | "sql" | "code";

export interface DataflowFinding {
  kind: SinkKind;
  /** high: reaches the sink with no condition on the way; review: a
   *  condition mentions it (verify), or an argument-level sink. */
  severity: "high" | "review";
  source: { file: string; line: number | null; what: string };
  sink: { file: string; nodeId: string; line: number | null; text: string; fn: string };
  /** the functions the value passed through, source first. */
  path: string[];
  guard: string | null;
  /** what the guard is: an `if` naming the value, or a guard-named call taking it */
  guardKind?: "condition" | "call";
  entryPointIds: string[];
}

export interface DataflowReport {
  findings: DataflowFinding[];
  sources: number;
  functionsReached: number;
  limits: string[];
}

interface IrNode { id: string; type: string; parentId?: string | null; line?: number; name?: string; params?: string[]; preview?: string; value?: string; callTarget?: string; funcName?: string; args?: string[]; effectKind?: string; condition?: string; target?: string; iterName?: string; }
interface IrFile { nodes?: IrNode[]; edges?: Array<{ source: string; target: string; type: string; targetFile?: string }>; language?: string }
interface EntryLike { id: string; kind?: string; file?: string; irNodeId?: string; framework?: string | null }
interface ThreadLike { entryPointId?: string | null; nodes?: Array<{ file?: string | null; irNodeId?: string | null }> }

export const DATAFLOW_LIMITS = [
  "name-based and flow-insensitive: statement order is not modelled",
  "a value stored in an object attribute or a container element and read back is not followed",
  "dynamic dispatch and unresolved calls are not followed",
  "a value that goes into a database, an API or a file and comes back out is not followed (second-order input)",
  "a guard is a condition that mentions the value, or a call to a guard-named function that takes it — not proof that it validates",
  "no findings is not a clean bill: it means none of these patterns matched",
];

// ── language helpers ───────────────────────────────────────────────────

/** The IR's own language stamp first (it covers extensionless shebang
 *  scripts), then the registry — never an extension check of our own. */
function langOf(file: string, ir: IrFile): Lang {
  const id = languageById(ir.language)?.id ?? languageForPath(file)?.id;
  return id === "python" || id === "jsts" || id === "bash" ? id : "other";
}

const SOURCE_PATTERNS: Record<Lang, RegExp[]> = {
  python: [/\brequest\.(args|form|json|values|data|files|headers|cookies|get_json|query_params|path_params|body|GET|POST|FILES|stream)\b/, /\bsys\.argv\b/, /(?<![\w.])input\s*\(/],
  jsts: [/\breq\.(body|query|params|headers|cookies|files|url)\b/, /\brequest\.(json|formData|text|body|headers|nextUrl)\b/, /\bsearchParams\b/, /\bprocess\.argv\b/, /\bctx\.(request|params|query)\b/],
  bash: [/\$\{?[1-9@*](?![\w])/],
  other: [],
};

const CLEANERS = /(?:^|[^\w.])(int|float|bool|Number|parseInt|parseFloat|Boolean|uuid\.UUID|UUID|shlex\.quote|quote|escape|escape_string|html\.escape|encodeURIComponent|sanitize\w*|clean\w*)\s*\(/;

/** A function whose name says it checks its argument: `guard_rel_script`,
 *  `validatePath`, `check_name`, `isSafeId`. Not `checkout`, not `ensure_dir`
 *  (it creates), not a bare `require` (in JS it loads a module), and never a
 *  call that is itself a sink (`subprocess.check_call`). Name-based, like CLEANERS. */
function isGuardCall(callee: string, lang: Lang): boolean {
  const last = callee.split(".").pop() ?? callee;
  if (lang === "jsts" && last === "require") return false;
  return /^(guard|validate|verify|assert|require)(?:$|[A-Z_]|[sd][A-Z_])/.test(last)
    || /^(check|is_?[Vv]alid|is_?[Ss]afe|is_?[Aa]llowed)(?:$|[A-Z_])/.test(last);
}

function sinkOf(n: IrNode, lang: Lang, shellImports: ReadonlySet<string> = new Set()): { kind: SinkKind; argIndex: number | "any" | "callee" } | null {
  const callee = (n.funcName ?? n.callTarget ?? "").trim();
  if (!callee) return null;
  const last = callee.split(".").pop() ?? callee;
  const args = n.args ?? [];
  const shellTrue = args.some((a) => /^shell\s*=\s*True$|shell\s*:\s*true/.test(a.replace(/\s+/g, " ")));
  if (lang === "python") {
    if (/^(os\.system|os\.popen|commands\.getoutput|subprocess\.getoutput|subprocess\.getstatusoutput)$/.test(callee)) return { kind: "command", argIndex: 0 };
    if (/^subprocess\.(run|call|check_call|check_output|Popen)$/.test(callee)) return { kind: shellTrue ? "command" : "argument", argIndex: 0 };
    if (/^(eval|exec|compile)$/.test(callee)) return { kind: "code", argIndex: 0 };
  }
  if (lang === "jsts") {
    // `exec(cmd)` / `child_process.execSync(cmd)` — never `regex.exec(s)` or a
    // database's `db.exec(sql)`, which only share the name.
    // A BARE name counts only when the file imports it from child_process:
    // `/re/.exec(s)` reaches the IR as a bare `exec` (the regex literal is
    // not a receiver name), and that one false positive was found on
    // a private production codebase before this rule existed.
    if (/^(child_process|cp|childProcess)\.(exec|execSync)$/.test(callee) || (/^(exec|execSync)$/.test(callee) && shellImports.has(callee))) return { kind: "command", argIndex: 0 };
    if (/^(child_process|cp|childProcess)\.(spawn|spawnSync|execFile|execFileSync)$/.test(callee) || (/^(spawn|spawnSync|execFile|execFileSync)$/.test(callee) && shellImports.has(callee))) return { kind: shellTrue ? "command" : "argument", argIndex: "any" };
    if (/^eval$|^(new )?Function$/.test(callee)) return { kind: "code", argIndex: 0 };
    if (/\$(queryRawUnsafe|executeRawUnsafe)$/.test(callee)) return { kind: "sql", argIndex: 0 };
  }
  if (lang === "bash") {
    if (callee === "eval") return { kind: "code", argIndex: "any" };
    if (/^(sh|bash|zsh)$/.test(callee) && args.includes("-c")) return { kind: "command", argIndex: args.indexOf("-c") + 1 };
    if (/^\$\{?\w+\}?$|^"\$\{?\w+\}?"$/.test(callee)) return { kind: "command", argIndex: "callee" };
    if (callee === "psql" && (args.includes("-c") || args.includes("--command"))) return { kind: "sql", argIndex: Math.max(args.indexOf("-c"), args.indexOf("--command")) + 1 };
    if (callee === "mysql" && args.includes("-e")) return { kind: "sql", argIndex: args.indexOf("-e") + 1 };
  }
  // SQL: the query text of a database call the IR marked db, or a well-known
  // query method on any receiver. A value passed separately is parameterised.
  if (/^(execute|executemany|executescript|query|raw|prepare|queryRaw)$/.test(last) && (n.effectKind === "db" || /(cursor|conn|connection|db|database|session|client|pool|knex|sql)\b/i.test(callee))) {
    return { kind: "sql", argIndex: 0 };
  }
  return null;
}

/** A node's own call and every call written inside its text. */
function callsOf(n: IrNode): Array<{ callee: string; args: string[]; own: boolean }> {
  const own = (n.funcName ?? n.callTarget) ? [{ callee: (n.funcName ?? n.callTarget)!, args: n.args ?? [], own: true }] : [];
  const text = n.type === "return_stmt" ? n.value ?? "" : n.type === "assignment" ? n.preview ?? "" : "";
  const inner = text ? callsInText(text).map((c) => ({ ...c, own: false })) : [];
  // A return / chain whose own call has no recorded args: take them from the text.
  if (own.length && !own[0].args.length) {
    const hit = inner.find((c) => c.callee === own[0].callee);
    if (hit) own[0].args = hit.args;
  }
  return [...own, ...inner.filter((c) => !own.some((o) => o.callee === c.callee))];
}

// ── the index ──────────────────────────────────────────────────────────

interface Fn { file: string; id: string; name: string; params: string[]; nodes: IrNode[]; lang: Lang }

function paramName(p: string, lang: Lang): string {
  let s = p.trim().replace(/^\*{1,2}|^\.\.\./, "");
  s = s.split(/[:=?]/)[0].trim();
  return lang === "bash" ? s : s.replace(/^[{[].*/, "");
}

function buildIndex(files: Record<string, IrFile>) {
  const fns = new Map<string, Fn>();
  const nodeFn = new Map<string, string>();
  const calls = new Map<string, Array<{ file: string; fnId: string }>>();
  /** per file, the local names bound by an import from child_process */
  const shellImports = new Map<string, Set<string>>();
  for (const [file, ir] of Object.entries(files)) {
    const lang = langOf(file, ir);
    for (const n of ir.nodes ?? []) {
      const mod = (n as { module?: string }).module;
      if (n.type !== "import_from" || !mod || !/^(node:)?child_process$/.test(mod)) continue;
      const set = shellImports.get(file) ?? shellImports.set(file, new Set()).get(file)!;
      for (const raw of (n as { names?: string[] }).names ?? []) {
        const [orig, alias] = raw.split(/\s+as\s+/);
        set.add((alias ?? orig).trim());
        if (!alias) set.add(orig.trim());
      }
    }
    const byId = new Map((ir.nodes ?? []).map((n) => [n.id, n]));
    const moduleKey = `${file}::module`;
    fns.set(moduleKey, { file, id: "module", name: "<module>", params: [], nodes: [], lang });
    for (const n of ir.nodes ?? []) if (n.type === "function_def") fns.set(`${file}::${n.id}`, { file, id: n.id, name: n.name ?? n.id, params: n.params ?? [], nodes: [], lang });
    for (const n of ir.nodes ?? []) {
      if (n.type === "function_def") continue;
      let cur = n.parentId ? byId.get(n.parentId) : undefined;
      while (cur && cur.type !== "function_def") cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      const key = cur ? `${file}::${cur.id}` : moduleKey;
      fns.get(key)!.nodes.push(n);
      nodeFn.set(`${file}::${n.id}`, key);
    }
    for (const e of ir.edges ?? []) {
      if (e.type !== "reference") continue;
      const k = `${file}::${e.source}`;
      (calls.get(k) ?? calls.set(k, []).get(k)!).push({ file: e.targetFile ? relTarget(e.targetFile, files) : file, fnId: e.target });
    }
  }
  return { fns, nodeFn, calls, shellImports };
}

/** A reference edge may carry an absolute or a relative target file. */
function relTarget(targetFile: string, files: Record<string, IrFile>): string {
  if (targetFile in files) return targetFile;
  const hit = Object.keys(files).find((f) => targetFile.endsWith(`/${f}`) || targetFile === f);
  return hit ?? targetFile;
}

// ── the pass ───────────────────────────────────────────────────────────

interface Taint { what: string; file: string; line: number | null; path: string[]; guard: string | null; guardKind?: "condition" | "call" }

export function computeDataflow(env: { files: Record<string, IrFile>; entryPoints?: EntryLike[]; threads?: ThreadLike[] }): DataflowReport {
  const { fns, calls, shellImports } = buildIndex(env.files);
  // name → taint, per function
  const tainted = new Map<string, Map<string, Taint>>();
  const work: string[] = [];
  let sources = 0;
  const seed = (fnKey: string, name: string, t: Taint) => {
    const m = tainted.get(fnKey) ?? tainted.set(fnKey, new Map()).get(fnKey)!;
    if (m.has(name)) return;
    m.set(name, t);
    work.push(fnKey);
  };

  // Handler parameters: a route or MCP tool receives what the caller sends.
  for (const e of env.entryPoints ?? []) {
    if (!e.file || !e.irNodeId) continue;
    const key = `${e.file}::${e.irNodeId}`;
    const fn = fns.get(key);
    if (!fn) continue;
    const handler = e.kind === "route" || e.framework === "mcp";
    const script = fn.lang === "bash" && (e.irNodeId === "module" || /(^|\/)main\.fn$/.test(e.irNodeId));
    if (handler) {
      for (const p of fn.params) {
        const name = paramName(p, fn.lang);
        if (!name || /^(self|cls|res|response|next|_)$/.test(name)) continue;
        seed(key, name, { what: `${e.framework === "mcp" ? "tool input" : "request parameter"} \`${name}\` of ${e.id}`, file: fn.file, line: null, path: [fn.name], guard: null });
        sources++;
      }
    }
    if (script) for (const pos of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "@", "*"]) seed(key, pos, { what: `command-line argument $${pos} of ${e.id}`, file: fn.file, line: null, path: [fn.name], guard: null });
  }

  // Every function: its own sources and assignments, to a fixed point; each
  // new taint re-queues the function and any callee it reaches.
  for (const key of fns.keys()) work.push(key);
  const seenCall = new Set<string>();
  const guardText = new Map<string, string>(); // fnKey|name → condition
  const callGuards = new Map<string, { text: string; line: number }>(); // fnKey|name → the first guard-named call taking it
  const derivedFrom = new Map<string, string[]>(); // fnKey|name → the tainted names its assignment was built from
  // The guard that covers a value at a line: an `if` naming it, a guard call
  // written at or before that line, or either on a value it was built from
  // (`TASK="$2"` after `guard_rel_path "$2"`), a few assignments back.
  const guardFor = (key: string, name: string, t: Taint, atLine: number | null): { text: string; kind: "condition" | "call" } | null => {
    const one = (nm: string) => {
      const cond = guardText.get(`${key}|${nm}`);
      if (cond) return { text: cond, kind: "condition" as const };
      const call = callGuards.get(`${key}|${nm}`);
      return call && (atLine == null || call.line <= atLine) ? { text: `${call.text} (line ${call.line})`, kind: "call" as const } : null;
    };
    const seen = new Set<string>();
    let frontier = [name];
    for (let depth = 0; depth < 4 && frontier.length; depth++) {
      for (const nm of frontier) { seen.add(nm); const g = one(nm); if (g) return g; }
      frontier = frontier.flatMap((nm) => derivedFrom.get(`${key}|${nm}`) ?? []).filter((nm) => !seen.has(nm));
    }
    return t.guard ? { text: t.guard, kind: t.guardKind ?? "condition" } : null;
  };
  while (work.length) {
    const key = work.pop()!;
    const fn = fns.get(key)!;
    const m = tainted.get(key) ?? new Map<string, Taint>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of fn.nodes) {
        if (n.type === "assignment" && n.name) {
          const raw = `${n.preview ?? ""} ${n.callTarget ?? ""}(${(n.args ?? []).join(", ")})`;
          const code = codeOf(raw, fn.lang);
          const names = boundNames(n.name).filter((b) => !m.has(b));
          if (!names.length || CLEANERS.test(code)) continue;
          const src = SOURCE_PATTERNS[fn.lang].find((re) => re.test(code));
          const via = [...m.entries()].find(([name]) => mentions(code, name, fn.lang));
          const from = [...m.keys()].filter((name) => mentions(code, name, fn.lang));
          for (const b of names) {
            if (from.length) derivedFrom.set(`${key}|${b}`, from);
            if (src) {
              const what = fn.lang === "bash" ? `command-line argument ${src.exec(code)?.[0] ?? ""}` : `\`${(n.preview ?? "").slice(0, 60)}\``;
              m.set(b, { what, file: fn.file, line: n.line ?? null, path: [fn.name], guard: null }); sources++; changed = true;
            } else if (via) { m.set(b, { ...via[1] }); changed = true; }
          }
        }
        if ((n.type === "for_loop" || n.type === "while_loop") && n.target && !m.has(n.target)) {
          const it = codeOf(n.iterName ?? n.condition ?? "", fn.lang);
          const via = [...m.entries()].find(([name]) => mentions(it, name, fn.lang));
          if (via) { m.set(n.target, { ...via[1] }); changed = true; }
        }
        // bash: `while read -r line` — the line is input.
        if (fn.lang === "bash" && n.type === "while_loop" && /^read\b/.test(n.condition ?? "")) {
          const v = (n.condition ?? "").split(/\s+/).filter((w) => /^\w+$/.test(w) && w !== "read").pop();
          if (v && !m.has(v)) { m.set(v, { what: `input read by \`${n.condition}\``, file: fn.file, line: n.line ?? null, path: [fn.name], guard: null }); sources++; changed = true; }
        }
        if (n.type === "if_stmt" && n.condition) {
          const code = codeOf(n.condition, fn.lang);
          for (const name of m.keys()) if (mentions(code, name, fn.lang)) guardText.set(`${key}|${name}`, n.condition.slice(0, 80));
        }
        const gc = (n.funcName ?? n.callTarget ?? "").trim();
        if ((n.type === "call" || n.type === "assignment") && gc && isGuardCall(gc, fn.lang) && !sinkOf(n, fn.lang, shellImports.get(fn.file))) {
          const code = codeOf((n.args ?? []).join(" "), fn.lang);
          const text = (fn.lang === "bash" ? `${gc} ${(n.args ?? []).join(" ")}` : `${gc}(${(n.args ?? []).join(", ")})`).slice(0, 80);
          for (const name of m.keys()) {
            const k = `${key}|${name}`;
            const prior = callGuards.get(k);
            if (mentions(code, name, fn.lang) && (!prior || (n.line ?? 0) < prior.line)) callGuards.set(k, { text, line: n.line ?? 0 });
          }
        }
      }
    }
    if (m.size) tainted.set(key, m);
    // A module-level value is in scope in every function of its file (a
    // global, or a closure over it) unless a parameter shadows it. Bash
    // positionals are not: a script's $1 is not a function's $1.
    if (fn.id === "module") {
      for (const [name, t] of m) {
        if (fn.lang === "bash" && /^[0-9@*]$/.test(name)) continue;
        for (const [otherKey, other] of fns) {
          if (other.file !== fn.file || other.id === "module") continue;
          if (other.params.some((p) => paramName(p, other.lang) === name)) continue;
          seed(otherKey, name, { ...t, path: [...t.path, other.name] });
        }
      }
    }
    // Across calls: a tainted argument taints the callee's parameter.
    for (const n of fn.nodes) {
      if (n.type !== "call" && n.type !== "assignment" && n.type !== "return_stmt") continue;
      const targets = calls.get(`${fn.file}::${n.id}`) ?? [];
      const ownArgs = callsOf(n).find((c) => c.own)?.args ?? [];
      if (!targets.length || !ownArgs.length) continue;
      ownArgs.forEach((a, i) => {
        const kw = fn.lang === "python" ? /^(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(a) : null;
        const code = codeOf(kw ? kw[2] : a, fn.lang);
        if (CLEANERS.test(code)) return;
        const via = [...m.entries()].find(([name]) => mentions(code, name, fn.lang)) ?? (SOURCE_PATTERNS[fn.lang].some((re) => re.test(code)) ? [null, { what: `\`${a.slice(0, 60)}\``, file: fn.file, line: n.line ?? null, path: [fn.name], guard: null }] as const : null);
        if (!via) return;
        for (const t of targets) {
          const tKey = `${t.file}::${t.fnId}`;
          const callee = fns.get(tKey);
          if (!callee) continue;
          const g = via[0] ? guardFor(key, via[0], via[1] as Taint, n.line ?? null) : null;
          const carry: Taint = { ...via[1], path: [...via[1].path, callee.name], guard: g?.text ?? via[1].guard, guardKind: g?.kind ?? (via[1] as Taint).guardKind };
          if (callee.lang === "bash") { seed(tKey, String(i + 1), carry); continue; }
          const names = callee.params.map((p) => paramName(p, callee.lang));
          const offset = names[0] === "self" || names[0] === "cls" ? 1 : 0;
          const target = kw ? kw[1] : names[i + offset];
          if (target && names.includes(target)) {
            const sk = `${tKey}|${target}`;
            if (!seenCall.has(sk)) { seenCall.add(sk); seed(tKey, target, carry); }
          }
        }
      });
    }
  }

  // Sinks.
  const findings: DataflowFinding[] = [];
  for (const [key, m] of tainted) {
    const fn = fns.get(key)!;
    for (const n of fn.nodes) {
      if (n.type !== "call" && n.type !== "assignment" && n.type !== "return_stmt") continue;
      for (const c of callsOf(n)) {
        const sink = sinkOf({ ...n, funcName: c.callee, callTarget: c.callee, args: c.args, effectKind: c.own ? n.effectKind : undefined }, fn.lang, shellImports.get(fn.file));
        if (!sink) continue;
        const args = c.args;
        const pool = sink.argIndex === "any" ? args : sink.argIndex === "callee" ? [c.callee] : [args[sink.argIndex] ?? ""];
        const hit = pool.map((a) => codeOf(a, fn.lang)).flatMap((code) => [...m.entries()].filter(([name]) => mentions(code, name, fn.lang)))[0];
        if (!hit) continue;
        const [name, t] = hit;
        const g = guardFor(key, name, t, n.line ?? null);
        findings.push({
          kind: sink.kind,
          severity: g || sink.kind === "argument" ? "review" : "high",
          source: { file: t.file, line: t.line, what: t.what },
          sink: { file: fn.file, nodeId: n.id, line: n.line ?? null, text: `${c.callee}(${args.join(", ")})`.slice(0, 160), fn: fn.name },
          path: t.path,
          guard: g?.text ?? null,
          ...(g ? { guardKind: g.kind } : {}),
          entryPointIds: [],
        });
        break;
      }
    }
  }
  // One statement is one finding: the parser can record a line as two nodes
  // (a call and the return that wraps it).
  // A call written across lines can surface as two nodes a line apart.
  const kept: DataflowFinding[] = [];
  const unique = findings.filter((f) => {
    const callee = f.sink.text.split("(")[0];
    const dup = kept.some((k) => k.sink.file === f.sink.file && k.sink.fn === f.sink.fn && k.kind === f.kind
      && k.sink.text.split("(")[0] === callee && Math.abs((k.sink.line ?? 0) - (f.sink.line ?? 0)) <= 2);
    if (dup) return false;
    kept.push(f);
    return true;
  });
  findings.length = 0;
  findings.push(...unique);
  // Which threads walk each sink's function.
  for (const f of findings) {
    const sinkFn = [...fns.entries()].find(([, v]) => v.file === f.sink.file && v.nodes.some((x) => x.id === f.sink.nodeId))?.[1];
    f.entryPointIds = (env.threads ?? [])
      .filter((t) => t.entryPointId && (t.nodes ?? []).some((x) => x.file === f.sink.file && (x.irNodeId === sinkFn?.id || x.irNodeId === f.sink.nodeId)))
      .map((t) => t.entryPointId!) ;
  }
  const order = { high: 0, review: 1 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.sink.file.localeCompare(b.sink.file) || (a.sink.line ?? 0) - (b.sink.line ?? 0));
  return { findings, sources, functionsReached: tainted.size, limits: DATAFLOW_LIMITS };
}

// The report in words lives in dataflow_format.ts; re-exported so callers keep one import.
export { formatUntrustedLines, findingsByThread, formatDataflowMd } from "./dataflow_format.ts";
