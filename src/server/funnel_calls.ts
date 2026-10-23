// WHAT A FUNNEL CALLS (2026-10-22, the root-cause handoff RC4: "funnel checks
// come from wording, not from what the funnel calls"). A funnel's `wraps`
// listed every wrappable tool its file IMPORTED, cut to the top-level package:
// a module importing `http` for its status codes and calling
// `urllib.request.urlopen` read "wrapping http, urllib", and a model checking
// the rule picked `http`, a door the funnel never uses. Here the funnel's own
// calls that LEAVE the project decide it (a call the parser stamps with an
// effect; constructing an object, `Request(…)` or `CookieJar()`, is not one;
// nor is encoding with `urllib.parse`): each by its full dotted name through
// the file's imports (call_names.ts), the language globals a tool table knows
// (`fetch`), and the programs it runs (process_launches.ts evidence).

import { fullCallName, packageOfCall } from "../shared/call_names.ts";
import { JSTS_GLOBAL_TOOLS, jstsPackageName, pythonToolName } from "../shared/stack_taxonomy.ts";
import type { StackToolRecord } from "../shared/protocol.ts";

interface NodeLike { id: string; type?: string; funcName?: string; callTarget?: string; names?: unknown; module?: unknown; effectKind?: string | null }

const calleeOf = (n: NodeLike): string =>
  n.type === "call" ? n.funcName ?? "" : (n.type === "assignment" || n.type === "return_stmt") ? n.callTarget ?? "" : "";

/** Each wrapped tool → the full names of what the funnel file calls in it. */
export function funnelCalls(file: string, nodes: ReadonlyArray<NodeLike>, language: string, wrapped: ReadonlyArray<Pick<StackToolRecord, "tool" | "evidence">>): Map<string, string[]> {
  const tools = new Set(wrapped.map((w) => w.tool));
  const toolOf = (full: string) => {
    const pkg = packageOfCall(full);
    return language === "python" ? pythonToolName(full.split(".").slice(0, 2).join(".")) : language === "jsts" ? jstsPackageName(pkg) : pkg;
  };
  const out = new Map<string, Set<string>>();
  const add = (tool: string, full: string) => { if (tools.has(tool)) (out.get(tool) ?? out.set(tool, new Set()).get(tool)!).add(full); };
  for (const n of nodes) {
    const c = calleeOf(n);
    // only a call that leaves the project, and not a construction
    if (!c || !n.effectKind || /^[A-Z]/.test(c.split(".").pop() ?? "")) continue;
    const full = fullCallName(c, nodes as never);
    if (full) { add(toolOf(full), full); add(packageOfCall(full), full); continue; }
    const head = c.split(".")[0];
    if (language === "jsts" && JSTS_GLOBAL_TOOLS[head]) add(head, c);
  }
  // a command word or a program a launch runs IS the call (bash, process_launches.ts)
  for (const w of wrapped) for (const e of w.evidence ?? []) if (e.file === file && (e.kind === "exec" || (language === "bash" && e.kind === "call"))) add(w.tool, w.tool);
  return new Map([...out].map(([t, s]) => [t, [...s].sort()]));
}
