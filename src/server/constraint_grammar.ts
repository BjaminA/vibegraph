// M-GRAMMAR — the CHECKABLE half of a stated constraint.
//
// The hole this closes was measured twice. A human states "region changes
// page through should_notify, and no other module may call notify". A model
// reviewer reads the diff, reads the words "routed through should_notify
// then notify", and approves — while the checker says
// `notifyCallers = [telemetry/ingest.py]`. The constraint was true as prose
// and false as fact, and prose is what the reviewer had.
//
// So a constraint may now carry a STRUCTURED half beside its sentence, in
// exactly the shape M-STACK's `policy` already uses: `text` stays the human
// sentence a worker reads, `check` is what the deterministic pre-checks
// evaluate against the IR. They are never merged — a render shows both, and
// their disagreement is a signal rather than a tie to break.
//
// THE FLOOR, and it is the whole point: there are THREE verdicts, never two.
//
//     pass          the IR shows no violation, and says what it could not follow
//     violated      the IR shows a violation, and names the offenders
//     unverifiable  the IR cannot answer — which is NOT a pass
//
// A checker that silently passes what it could not check is worse than the
// prose reviewer it replaces, because it looks like proof. An unverifiable
// constraint goes to the model with its reason, exactly like any other thing
// the pre-checks cannot vouch for.
//
// Pure over injected facts: no fs, no live state, no IR walking of its own.
// The caller supplies what the project's edges already say.

/** What a human can say that the IR can check.
 *
 *  `calls-through` is its OWN predicate, and a first cut got it wrong in a
 *  way worth recording: I read "every call to A goes through B" as "every
 *  caller of A IS B", which flagged the fleet example's compliant code —
 *  `evaluate` does `if should_notify(...): notify(...)`, so the caller is
 *  `evaluate` and the guard is `should_notify`. Running the check against
 *  real code before shipping it is what caught that, and a FALSE VIOLATION
 *  is worse than a false pass here: it rejects correct work.
 *
 *  The honest reading, and the one people mean: every function that calls
 *  `target` ALSO calls `through`. Its limit is stated wherever it renders —
 *  it does not prove the call to `through` GUARDS the call to `target`, only
 *  that the function does both. Order and control flow are not checked. */
export type ConstraintCheck =
  | { rule: "callers-only"; target: string; files?: string[]; functions?: string[] }
  | { rule: "import-only"; tool: string; files: string[] }
  | { rule: "calls-through"; target: string; through: string };

export const CHECK_RULES = ["callers-only", "import-only", "calls-through"] as const;

/** One resolved call, as the linker recorded it. */
export interface ReferenceFact {
  /** File the CALL is written in. */
  fromFile: string;
  /** The calling node's id (its enclosing function is its id prefix). */
  fromNodeId: string;
  /** File the callee is defined in, when the linker resolved cross-file. */
  toFile: string | null;
  /** The callee's bare name (`notify`), from its node id or qualified target. */
  toName: string;
}

/** A call the IR could NOT resolve, and therefore could be anything. */
export interface UnresolvedFact {
  file: string;
  label: string;
}

export interface CheckFacts {
  references: ReferenceFact[];
  /** file -> the tool names imported there (the stack index's view). */
  importsByFile: Record<string, string[]>;
  /** Every name the IR knows as a DEFINITION, so "no such target" is
   *  detectable rather than silently vacuous. */
  definedNames: string[];
  /** Dynamic / unresolved calls. A hidden caller can only hide here. */
  unresolved: UnresolvedFact[];
}

export interface CheckResult {
  verdict: "pass" | "violated" | "unverifiable";
  reason: string;
  /** `file:node` for each violation, so a reject is actionable. */
  offenders: string[];
}

/** Which function each call to `target` is written in, with its file. */
function callersOf(facts: CheckFacts, target: string): Array<{ fn: string; file: string; nodeId: string }> {
  const out: Array<{ fn: string; file: string; nodeId: string }> = [];
  for (const r of facts.references) {
    if (r.toName !== target) continue;
    const fn = enclosingFunction(r.fromNodeId);
    if (fn) out.push({ fn, file: r.fromFile, nodeId: r.fromNodeId });
  }
  return out;
}

function checkCallsThrough(
  facts: CheckFacts,
  check: Extract<ConstraintCheck, { rule: "calls-through" }>,
): CheckResult {
  const { target, through } = check;
  const known = new Set(facts.definedNames);
  const callers = callersOf(facts, target);
  if (!known.has(target) && callers.length === 0) {
    return {
      verdict: "unverifiable",
      reason: `the IR knows no definition of \`${target}\` and no call to it. NOT treated as satisfied.`,
      offenders: [],
    };
  }
  if (!known.has(through)) {
    return {
      verdict: "unverifiable",
      reason: `the IR knows no definition of \`${through}\` — the guard this constraint names `
        + "does not exist in the project as spelled. NOT treated as satisfied.",
      offenders: [],
    };
  }
  // A function satisfies the rule when it ALSO calls the guard. `through`
  // itself trivially satisfies it (a guard need not guard itself).
  const guardCallers = new Set(
    callersOf(facts, through).map((c) => `${c.file}::${c.fn}`),
  );
  const offenders = callers
    .filter((c) => c.fn !== through && !guardCallers.has(`${c.file}::${c.fn}`))
    .map((c) => `${c.file}:${c.nodeId}`);
  const hidden = hiddenCandidates(facts, target);
  if (offenders.length) {
    return {
      verdict: "violated",
      reason: `\`${target}\` is called from function(s) that never call \`${through}\`: ${offenders.join(", ")}.`,
      offenders,
    };
  }
  if (hidden.length) {
    return {
      verdict: "unverifiable",
      reason: `every resolved caller of \`${target}\` also calls \`${through}\`, but `
        + `${hidden.length} unresolved/dynamic call(s) could be \`${target}\` `
        + `(${hidden.map((h) => `${h.file}: ${h.label}`).join("; ")}).`,
      offenders: [],
    };
  }
  return {
    verdict: "pass",
    reason: `all ${callers.length} function(s) calling \`${target}\` also call \`${through}\` `
      + "(NOT checked: that the guard actually governs the call — order and control flow are outside this check)",
    offenders: [],
  };
}

/** Validation at the boundary: a check that arrives malformed is REFUSED,
 *  never coerced. A coerced check would evaluate something nobody stated. */
export function isConstraintCheck(v: unknown): v is ConstraintCheck {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  const strs = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string" && s.length > 0);
  if (c.rule === "callers-only") {
    if (typeof c.target !== "string" || !c.target) return false;
    const hasFiles = c.files !== undefined, hasFns = c.functions !== undefined;
    if (!hasFiles && !hasFns) return false; // "callers only … nowhere" is not a rule
    return (!hasFiles || strs(c.files)) && (!hasFns || strs(c.functions));
  }
  if (c.rule === "import-only") return typeof c.tool === "string" && !!c.tool && strs(c.files);
  if (c.rule === "calls-through") return typeof c.target === "string" && !!c.target
    && typeof c.through === "string" && !!c.through;
  return false;
}

/** The enclosing function of a call node: `module/ingest.fn/x.assign` →
 *  `ingest`. Structural ids make this a slice, not a guess. */
export function enclosingFunction(nodeId: string): string | null {
  const seg = nodeId.split("/").find((s) => s.endsWith(".fn"));
  return seg ? seg.slice(0, -3) : null;
}

/** How many unresolved calls could plausibly BE the target — the honest
 *  caveat every verdict carries. A label that mentions the name is a
 *  candidate; anything else is noise we say we did not follow. */
function hiddenCandidates(facts: CheckFacts, target: string): UnresolvedFact[] {
  return facts.unresolved.filter((u) => u.label === target || u.label.endsWith(`.${target}`));
}

function checkCallersOnly(
  facts: CheckFacts,
  check: Extract<ConstraintCheck, { rule: "callers-only" }>,
): CheckResult {
  const { target } = check;
  const known = new Set(facts.definedNames);
  const calls = facts.references.filter((r) => r.toName === target);
  const hidden = hiddenCandidates(facts, target);

  if (!known.has(target) && calls.length === 0) {
    return {
      verdict: "unverifiable",
      reason: `the IR knows no definition of \`${target}\` and no call to it — `
        + "the constraint may be about code that does not exist yet, or about a name "
        + "this project spells differently. NOT treated as satisfied.",
      offenders: [],
    };
  }

  const allowedFiles = new Set(check.files ?? []);
  const allowedFns = new Set(check.functions ?? []);
  const offenders: string[] = [];
  for (const c of calls) {
    const fileOk = allowedFiles.size > 0 && allowedFiles.has(c.fromFile);
    const fn = enclosingFunction(c.fromNodeId);
    const fnOk = allowedFns.size > 0 && !!fn && allowedFns.has(fn);
    // A caller satisfies the rule when it is inside ANY allowed place. With
    // both lists given, either alone is enough: "only alerts.py, and only
    // should_notify" is two ways of saying where, not two hurdles.
    if (fileOk || fnOk) continue;
    offenders.push(`${c.fromFile}:${c.fromNodeId}`);
  }

  const where = [
    ...(check.files?.length ? [`file(s) ${check.files.join(", ")}`] : []),
    ...(check.functions?.length ? [`function(s) ${check.functions.join(", ")}`] : []),
  ].join(" or ");
  if (offenders.length) {
    return {
      verdict: "violated",
      reason: `\`${target}\` is called from outside ${where}: ${offenders.join(", ")}.`,
      offenders,
    };
  }
  if (hidden.length) {
    return {
      verdict: "unverifiable",
      reason: `no RESOLVED call to \`${target}\` sits outside ${where}, but `
        + `${hidden.length} unresolved/dynamic call(s) could be it `
        + `(${hidden.map((h) => `${h.file}: ${h.label}`).join("; ")}). The IR cannot follow those.`,
      offenders: [],
    };
  }
  return {
    verdict: "pass",
    reason: `all ${calls.length} resolved call(s) to \`${target}\` are inside ${where}`
      + (facts.unresolved.length
        ? ` (${facts.unresolved.length} unresolved/dynamic call(s) elsewhere in the project were not followed; none names \`${target}\`)`
        : ""),
    offenders: [],
  };
}

function checkImportOnly(
  facts: CheckFacts,
  check: Extract<ConstraintCheck, { rule: "import-only" }>,
): CheckResult {
  const allowed = new Set(check.files);
  const importers = Object.entries(facts.importsByFile)
    .filter(([, tools]) => tools.includes(check.tool))
    .map(([file]) => file);
  if (importers.length === 0) {
    return {
      verdict: "unverifiable",
      reason: `no file in the IR imports \`${check.tool}\` — the constraint may be about a `
        + "tool this project does not use yet. NOT treated as satisfied.",
      offenders: [],
    };
  }
  const offenders = importers.filter((f) => !allowed.has(f));
  if (offenders.length) {
    return {
      verdict: "violated",
      reason: `\`${check.tool}\` is imported outside ${check.files.join(", ")}: ${offenders.join(", ")}.`,
      offenders,
    };
  }
  return {
    verdict: "pass",
    reason: `\`${check.tool}\` is imported only in ${importers.join(", ")}`,
    offenders: [],
  };
}

/** Evaluate one constraint's structured half against the project's facts. */
export function checkConstraint(facts: CheckFacts, check: ConstraintCheck): CheckResult {
  switch (check.rule) {
    case "import-only": return checkImportOnly(facts, check);
    case "calls-through": return checkCallsThrough(facts, check);
    case "callers-only": return checkCallersOnly(facts, check);
  }
}

/** One line per constraint, for a pre-check trail a human can read. */
export function describeCheck(check: ConstraintCheck): string {
  switch (check.rule) {
    case "callers-only": {
      const where = [
        ...(check.files?.length ? [check.files.join(", ")] : []),
        ...(check.functions?.length ? [check.functions.join(", ")] : []),
      ].join(" or ");
      return `callers of \`${check.target}\` only in ${where}`;
    }
    case "import-only":
      return `\`${check.tool}\` imported only in ${check.files.join(", ")}`;
    case "calls-through":
      return `every call to \`${check.target}\` goes through \`${check.through}\``;
  }
}
