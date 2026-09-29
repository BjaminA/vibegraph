// STACK POLICIES, CHECKED (2026-09-29). A stack policy already says, in its
// structured `policy`, which imports are allowed — `forbid requests`,
// `replace-with telemetry.http_client` — so its check is DERIVED from it
// rather than stated a second time. Before this, a policy with no `check`
// clause was delivered as prose and never enforced by the hooks or the CLI
// (the work-run pre-check was the only reader, and only of a packet's delta).
//
//   forbid T              → T is imported nowhere.
//   replace-with W        → W a project module (the funnel that wraps T):
//                           T is imported only in W's file. W another tool:
//                           T is imported nowhere (use W instead).
//   require / prefer / describe → nothing derived: "prefer" is advice,
//                           "require" names a role, "describe" classifies.
//
// Unlike the `import-only` verb, "nobody imports T" is a PASS here: for a
// forbid that absence is exactly the policy. A constraint that already
// carries an import-only clause for the same tool gets no derived twin.
// Pure: constraint + facts in, clauses and verdicts out.

import type { CheckFacts, CheckResult } from "./constraint_grammar.ts";

export interface PolicyClause {
  rule: "stack-policy";
  policy: "forbid" | "replace-with";
  tool: string;
  /** files that may import `tool` (empty: none may). */
  allowed: string[];
  with?: string;
  /** `with` looks like a project module and no parsed file is it. */
  unresolvedWith?: true;
}

interface PolicyLike {
  kind?: string;
  policy?: { tool: string; rule: string; with?: string };
  check?: unknown;
  checks?: unknown[];
}

/** The file a module name names: a Python dotted path, or a path without
 *  its extension. null when no parsed file answers to it. */
export function moduleFileOf(files: Record<string, { modulePath?: string }>, name: string): string | null {
  const bare = name.replace(/\.(py|ts|tsx|mts|cts|mjs|cjs|sh|rs|cpp|h)$/, "");
  for (const [file, ir] of Object.entries(files)) {
    if (ir?.modulePath === name) return file;
    const noExt = file.replace(/\.[^./]+$/, "");
    if (noExt === bare || noExt.replace(/\//g, ".") === bare || noExt.endsWith(`/${bare}`)) return file;
  }
  return null;
}

export function derivedPolicyClauses(c: PolicyLike, files: Record<string, { modulePath?: string }>): PolicyClause[] {
  const p = c.policy;
  if (!p || (p.rule !== "forbid" && p.rule !== "replace-with")) return [];
  const stated = [...(c.checks ?? []), ...(c.check ? [c.check] : [])] as Array<Record<string, unknown>>;
  if (stated.some((s) => s?.rule === "import-only" && s.tool === p.tool)) return [];
  if (p.rule === "forbid") return [{ rule: "stack-policy", policy: "forbid", tool: p.tool, allowed: [] }];
  const funnel = p.with ? moduleFileOf(files, p.with) : null;
  // `with` spelled like a project module (dotted, relative, an alias) that no
  // parsed file answers to: the funnel's own import cannot be told from an
  // offender, so the verdict is unverifiable rather than a false violation.
  const moduleLike = !!p.with && !funnel && /^(\.|@\/|~\/)|[./]/.test(p.with) && !/^@[^/]+\/[^/]+$/.test(p.with);
  return [{
    rule: "stack-policy", policy: "replace-with", tool: p.tool, allowed: funnel ? [funnel] : [],
    ...(p.with ? { with: p.with } : {}), ...(moduleLike ? { unresolvedWith: true } : {}),
  }];
}

export function describePolicyClause(cl: PolicyClause): string {
  if (cl.policy === "forbid") return `\`${cl.tool}\` is imported nowhere (forbidden by policy)`;
  return cl.allowed.length
    ? `\`${cl.tool}\` is imported only in ${cl.allowed.join(", ")} (the \`${cl.with}\` funnel replaces it everywhere else)`
    : `\`${cl.tool}\` is imported nowhere (policy: use \`${cl.with}\` instead)`;
}

export function checkPolicyClause(facts: CheckFacts, cl: PolicyClause): CheckResult {
  if (cl.unresolvedWith) {
    return {
      verdict: "unverifiable",
      reason: `the policy names \`${cl.with}\` as the replacement, and no parsed file is that module — its own import of \`${cl.tool}\` cannot be told apart from an offender`,
      offenders: [],
    };
  }
  const allowed = new Set(cl.allowed);
  const importers = Object.entries(facts.importsByFile).filter(([, tools]) => tools.includes(cl.tool)).map(([f]) => f);
  const offenders = importers.filter((f) => !allowed.has(f));
  if (offenders.length) {
    return {
      verdict: "violated",
      reason: cl.policy === "forbid"
        ? `\`${cl.tool}\` is forbidden by a stated policy and is imported in ${offenders.join(", ")}.`
        : `\`${cl.tool}\` is to be replaced by \`${cl.with}\`${cl.allowed.length ? ` (only ${cl.allowed.join(", ")} may import it)` : ""}, and is imported in ${offenders.join(", ")}.`,
      offenders,
    };
  }
  return {
    verdict: "pass",
    reason: importers.length
      ? `\`${cl.tool}\` is imported only in ${importers.join(", ")}`
      : `no file in the IR imports \`${cl.tool}\` — which is what the policy asks (an import the parser could not read is outside this check)`,
    offenders: [],
  };
}
