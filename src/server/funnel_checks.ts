// A FUNNEL RULE'S CHECK, DERIVED (2026-10-22, the root-cause handoff RC4).
// "Every outbound request goes through the funnel" is checked by what the
// funnel calls (funnel_calls.ts), never by a tool a model picked from its
// imports. Per tool the funnel calls:
//
//   a standard-library namespace   callers-only on each function the funnel
//     (urllib, http, subprocess)   calls: `urllib.parse` elsewhere is not a
//                                  bypass, `urllib.request.urlopen` is
//   any other package (requests,   import-only: the funnel often calls a
//     axios)                       constructor and then the instance, so
//                                  importing the package anywhere else IS the
//                                  bypass, whichever function it then calls
//
// the funnel and any stated exception allowed. And a check that guards a door
// the funnel does not use is TRIVIAL: it passes whatever bypasses the funnel,
// so it is said, not reported as enforcement.

import type { ConstraintCheck } from "./constraint_grammar.ts";
import { packageOfCall } from "../shared/call_names.ts";

export interface FunnelLike { tool: string; home?: string; wraps?: string[]; calls?: string[] }
interface ToolLike { tool: string; origin: string; home?: string; wraps?: string[]; calls?: string[]; evidence?: ReadonlyArray<{ file: string; kind?: string }> }
interface StackLike { tools: ReadonlyArray<ToolLike> }

/** The checks a funnel rule gets by default; empty when nothing it calls can be named. */
export function funnelChecks(funnel: FunnelLike, exceptions: readonly string[] = [], stack?: StackLike | null): ConstraintCheck[] {
  if (!funnel.home) return [];
  const files = [...new Set([funnel.home, ...exceptions])];
  const originOf = (t: string) => stack?.tools.find((x) => x.tool === t && x.origin !== "project")?.origin ?? "third-party";
  const out: ConstraintCheck[] = [];
  for (const tool of funnel.wraps ?? []) {
    const calls = (funnel.calls ?? []).filter((c) => c === tool || c.startsWith(`${tool}.`) || packageOfCall(c) === tool);
    if (originOf(tool) === "stdlib") {
      for (const target of calls.filter((c) => c.includes("."))) out.push({ rule: "callers-only", target, files } as ConstraintCheck);
    } else if (calls.length) out.push({ rule: "import-only", tool, files } as ConstraintCheck);
  }
  return out;
}

/** Why a check cannot catch the bypass its funnel rule is about, or null. */
export function trivialCheck(check: unknown, stack: StackLike | null | undefined): string | null {
  const c = check as { rule?: string; tool?: string; files?: string[] } | null;
  if (!c || c.rule !== "import-only" || !c.tool || !stack) return null;
  for (const f of stack.tools) {
    if (f.origin !== "project" || !f.home || !(c.files ?? []).includes(f.home) || !f.calls?.length) continue;
    const importsIt = stack.tools.some((t) => t.tool === c.tool && (t.evidence ?? []).some((e) => e.file === f.home && e.kind === "import"));
    if (importsIt && !(f.wraps ?? []).includes(c.tool)) {
      return `${f.home} imports ${c.tool} but makes no call through it that leaves the project, so this check passes whatever bypasses the funnel; what leaves is ${f.calls.slice(0, 3).join(", ")}${f.calls.length > 3 ? ", …" : ""}`;
    }
  }
  return null;
}
