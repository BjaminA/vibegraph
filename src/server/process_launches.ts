// WHICH PROGRAM A LAUNCH RUNS (2026-10-22, the root-cause handoff RC3: "the
// boundary model ends at the first library call"). `subprocess.run([binary,
// …])` was attributed to the tool `subprocess`, so every service behind a
// command-line client vanished and a model filled the gap from the docs. Here
// each Python or TypeScript launch is found and its first argument followed to
// the program it runs (launch_args.ts: a literal, a constant, an env default, a
// `which()` lookup, a parameter to the calls that fill it, an attribute to where
// the class sets it). What cannot be followed is kept as unresolved with its
// text, never guessed. A launch of an interpreter (python, node, bash) runs a
// script, which the command crossings already follow, so it is not a program
// here. Bash needs none of this: a command word is already the program.

import { argsOfCallText, firstArg, resolveLaunchArg, scopeOf, type ArgEnvLike, type IrNode, type LaunchFrom } from "./launch_args.ts";

export type { LaunchFrom };
export { valueOf } from "./launch_args.ts";
export type LaunchEnvLike = ArgEnvLike;

export interface ProcessLaunch {
  /** where the program is decided: the launch, or (when its callers run different programs) the call that passes it */
  file: string; nodeId: string; line?: number; language: string;
  /** the program's name (a path's basename), or null when the code does not say */
  executable: string | null;
  from: LaunchFrom;
  /** the first argument as written at the launch */
  expr: string;
  /** set when the launch passes its program through a parameter: the launching call itself */
  launch?: { file: string; nodeId: string; line?: number };
}

/** Python launchers: module function → whether its argument is a shell string. */
const PY_LAUNCH: Record<string, "argv" | "shell"> = {
  "subprocess.run": "argv", "subprocess.call": "argv", "subprocess.check_call": "argv", "subprocess.check_output": "argv",
  "subprocess.Popen": "argv", "subprocess.getoutput": "shell", "subprocess.getstatusoutput": "shell",
  "os.system": "shell", "os.popen": "shell", "os.execvp": "argv", "os.execlp": "argv", "os.spawnvp": "argv", "os.spawnlp": "argv",
  "asyncio.create_subprocess_exec": "argv", "asyncio.create_subprocess_shell": "shell",
};
/** Node's child_process: function → whether its argument is a shell string (`fork` runs a module, not a program). */
const JS_LAUNCH: Record<string, "argv" | "shell"> = {
  execFile: "argv", execFileSync: "argv", spawn: "argv", spawnSync: "argv", exec: "shell", execSync: "shell",
};
/** Programs that run a script: the script, not the interpreter, is what runs. */
const INTERPRETERS = new Set(["python", "python3", "py", "pypy", "node", "deno", "bun", "tsx", "ts-node", "bash", "sh", "zsh", "dash"]);

/** The program a word names: a path's basename, without `.exe`; null for a script or an interpreter. */
export function programOf(word: string): string | null {
  const w = word.trim();
  if (!w || /[\s$]/.test(w)) return null;
  if (/^\.{1,2}\//.test(w) || /\.(py|sh|bash|js|mjs|cjs|ts)$/.test(w)) return null; // a project script: a command crossing
  const base = w.split(/[\\/]/).pop()!.replace(/\.exe$/i, "");
  if (!/^[A-Za-z0-9][\w.+-]*$/.test(base) || INTERPRETERS.has(base.replace(/[0-9.]+$/, ""))) return null;
  return base;
}

function childProcessNames(nodes: IrNode[]): { bare: Set<string>; namespaces: Set<string> } {
  const bare = new Set<string>(), namespaces = new Set<string>();
  for (const n of nodes) {
    if (n.type !== "import_from" || !/^(node:)?child_process$/.test(n.module ?? "")) continue;
    for (const raw of n.names ?? []) {
      const m = /^(?:\*|default) as (\w+)$/.exec(raw);
      if (m) namespaces.add(m[1]);
      else { const alias = / as (\w+)$/.exec(raw); bare.add(alias ? alias[1] : raw); }
    }
  }
  return { bare, namespaces };
}

/** Every process launch in the project's Python and TypeScript files. */
export function processLaunches(env: LaunchEnvLike): ProcessLaunch[] {
  const out: ProcessLaunch[] = [];
  for (const [file, ir] of Object.entries(env.files)) {
    const lang = ir.language ?? "";
    if (lang !== "python" && lang !== "jsts") continue;
    const nodes = ir.nodes ?? [];
    const cp = lang === "jsts" ? childProcessNames(nodes) : null;
    const pyBare = lang === "python" ? new Map(nodes.filter((n) => n.type === "import_from" && /^(subprocess|os)$/.test(n.module ?? ""))
      .flatMap((n) => (n.names ?? []).map((x) => [x, `${n.module}.${x}`] as const))) : null;
    for (const n of nodes) {
      // a call, a call bound to a name, or a returned call (`return subprocess.run(…)`)
      if (n.type !== "call" && !((n.type === "assignment" || n.type === "return_stmt") && n.callTarget)) continue;
      const callee = n.type === "call" ? n.funcName ?? "" : n.callTarget ?? "";
      let mode: "argv" | "shell" | undefined;
      if (lang === "python") mode = PY_LAUNCH[callee] ?? PY_LAUNCH[pyBare!.get(callee) ?? ""];
      else {
        const [head, tail] = callee.includes(".") ? [callee.slice(0, callee.lastIndexOf(".")), callee.slice(callee.lastIndexOf(".") + 1)] : ["", callee];
        if ((head && (cp!.namespaces.has(head) || head === "child_process")) || (!head && cp!.bare.has(tail))) mode = JS_LAUNCH[tail];
      }
      if (!mode) continue;
      const expr = n.args?.[0] ?? argsOfCallText((n as { value?: string }).value ?? n.preview ?? "").find((a) => !a.kw)?.text ?? "";
      if (/^\s*(sys\.executable|process\.execPath)\s*$/.test(firstArg(expr).first)) continue; // the interpreter itself: a script runs
      const here = { file, nodeId: n.id, ...(n.line ? { line: n.line } : {}) };
      const hits = resolveLaunchArg(expr, scopeOf(file, nodes, n), mode === "shell", env);
      if (!hits) { out.push({ ...here, language: lang, executable: null, from: "unresolved", expr: expr.slice(0, 120) }); continue; }
      const found = hits.map((h) => ({ ...h, program: programOf(h.word) })).filter((h) => h.program);
      const programs = new Set(found.map((h) => h.program));
      if (programs.size === 1) {
        // one program, whichever call fills it: decided at the launch
        out.push({ ...here, language: lang, executable: found[0].program, from: found[0].from, expr: expr.slice(0, 120) });
        continue;
      }
      // its callers run different programs: each is decided at the call that passes it
      for (const h of found) out.push({ ...(h.via ?? here), language: lang, executable: h.program, from: h.from, expr: expr.slice(0, 120), ...(h.via ? { launch: here } : {}) });
    }
  }
  return out;
}
