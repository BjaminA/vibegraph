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

import {
  checkPayloadKeys, describePayloadKeys, isPayloadKeysCheck,
  type CallSiteFact, type PayloadKeysCheck,
} from "./payload_check.ts";
import { checkAlwaysWith, checkIdScheme, checkLayer, checkSingleWriter, describeAuthority, describeLayer, isAuthorityCheck, isLayerCheck, type AlwaysWithCheck, type ArchCheckFacts, type IdSchemeCheck, type LayerCheck, type SingleWriterCheck } from "./arch_checks.ts";
import { checkTopology, describeTopologyCheck, isTopologyCheck, type TopologyCheck } from "./topology_checks.ts";
import { pathAllowed, describeAllowList } from "../shared/path_match.ts";
import { callReaches, modulesNamed, resolveTarget, type TargetFacts } from "./check_targets.ts";

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
  | { rule: "callers-only"; target: string; files?: string[]; functions?: string[]; allowTests?: boolean }
  | { rule: "import-only"; tool: string; files: string[]; allowTests?: boolean }
  | { rule: "calls-through"; target: string; through: string }
  | PayloadKeysCheck
  | LayerCheck
  | SingleWriterCheck
  | AlwaysWithCheck
  | IdSchemeCheck
  | TopologyCheck;

export const CHECK_RULES = ["callers-only", "import-only", "calls-through", "payload-keys", "layer", "single-writer", "always-with", "id-scheme", "writer-subset", "no-write"] as const;

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

/** 2026-09-30 — a call the linker did not resolve into the project, with
 *  where it is written: what a check on an EXTERNAL API reads. */
export interface ExternalCallFact {
  file: string;
  label: string;
  nodeId: string;
}

export interface CheckFacts extends ArchCheckFacts, TargetFacts {
  references: ReferenceFact[];
  /** file -> the tool names imported there (the stack index's view). */
  importsByFile: Record<string, string[]>;
  /** Every name the IR knows as a DEFINITION, so "no such target" is
   *  detectable rather than silently vacuous. */
  definedNames: string[];
  /** Dynamic / unresolved calls. A hidden caller can only hide here. */
  unresolved: UnresolvedFact[];
  /** Every call site with the keys its arguments spell (`payload-keys`).
   *  Optional: a builder that does not supply it makes that verb
   *  unverifiable, never a pass. */
  callSites?: CallSiteFact[];
  /** 2026-09-30 — external call sites. A target spelled with a receiver
   *  (`ledgerbox.get_blob`: exactly that call) or as `*.get_blob` (that method
   *  on any receiver) is a call into ANOTHER library, found here; a bare name
   *  stays a project function, exactly as before. Optional: a builder without
   *  it makes such a target unverifiable, never a pass. */
  externalCalls?: ExternalCallFact[];
}

export interface CheckResult {
  verdict: "pass" | "violated" | "unverifiable";
  reason: string;
  /** `file:node` for each violation, so a reject is actionable. */
  offenders: string[];
}

/** Which function each call to `target` is written in, with its file. */
/** Does this target name an external API call? (`lib.fn` or `*.fn`) */
export function isExternalTarget(target: string): boolean {
  return target.startsWith("*.") || (target.includes(".") && !target.includes("/"));
}

function externalMatches(target: string, label: string): boolean {
  if (target.startsWith("*.")) {
    const m = target.slice(2);
    return label === m || label.endsWith(`.${m}`);
  }
  return label === target;
}

function callersOf(facts: CheckFacts, target: string): Array<{ fn: string; file: string; nodeId: string }> {
  const out: Array<{ fn: string; file: string; nodeId: string }> = [];
  const t = resolveTarget(facts, target);
  if (t.kind === "external") {
    for (const c of facts.externalCalls ?? []) {
      if (!externalMatches(target, c.label)) continue;
      const fn = enclosingFunction(c.nodeId);
      if (fn) out.push({ fn, file: c.file, nodeId: c.nodeId });
    }
  }
  // 2026-10-07 — a call counts only when it is bound to THIS definition
  // (check_targets.ts): another file's same-named function is not it
  const def = t.kind === "project" ? t : { name: target, file: null };
  for (const r of facts.references) {
    if (!callReaches(r, def)) continue;
    const fn = enclosingFunction(r.fromNodeId);
    if (fn) out.push({ fn, file: r.fromFile, nodeId: r.fromNodeId });
  }
  return out;
}

/** The name a target's definition goes by (`tools/x.py:fn` -> fn). */
function targetName(facts: CheckFacts, target: string): string {
  const t = resolveTarget(facts, target);
  return t.kind === "project" ? t.name : target;
}

function checkCallsThrough(
  facts: CheckFacts,
  check: Extract<ConstraintCheck, { rule: "calls-through" }>,
): CheckResult {
  const { target, through } = check;
  const known = new Set(facts.definedNames);
  for (const spelled of [target, through]) {
    const t = resolveTarget(facts, spelled);
    if (t.kind === "error") return { verdict: "unverifiable", reason: `${t.reason}. NOT treated as satisfied.`, offenders: [] };
  }
  const callers = callersOf(facts, target);
  if (!known.has(targetName(facts, target)) && callers.length === 0) {
    return {
      verdict: "unverifiable",
      reason: `the IR knows no definition of \`${target}\` and no call to it. NOT treated as satisfied.`,
      offenders: [],
    };
  }
  if (!known.has(targetName(facts, through))) {
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
  const throughName = targetName(facts, through);
  const offenders = callers
    .filter((c) => c.fn !== throughName && !guardCallers.has(`${c.file}::${c.fn}`))
    .map((c) => `${c.file}:${c.nodeId}`);
  const hidden = hiddenCandidates(facts, targetName(facts, target));
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
    if (!hasFiles && !hasFns && c.allowTests !== true) return false; // "callers only … nowhere" is not a rule
    if (c.allowTests !== undefined && typeof c.allowTests !== "boolean") return false;
    return (!hasFiles || strs(c.files)) && (!hasFns || strs(c.functions));
  }
  if (c.rule === "import-only") return typeof c.tool === "string" && !!c.tool && strs(c.files)
    && (c.allowTests === undefined || typeof c.allowTests === "boolean");
  if (c.rule === "calls-through") return typeof c.target === "string" && !!c.target
    && typeof c.through === "string" && !!c.through;
  if (c.rule === "payload-keys") return isPayloadKeysCheck(c);
  if (c.rule === "layer") return isLayerCheck(c);
  // 2026-10-02 — single-writer WITHOUT `writes` is the declared-topology form.
  if (c.rule === "writer-subset" || c.rule === "no-write" || (c.rule === "single-writer" && c.writes === undefined)) return isTopologyCheck(c);
  if (c.rule === "single-writer" || c.rule === "always-with" || c.rule === "id-scheme") return isAuthorityCheck(c);
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
  // An external target COUNTS its calls (callersOf); none of them is hidden.
  if (isExternalTarget(target)) return [];
  return facts.unresolved.filter((u) => u.label === target || u.label.endsWith(`.${target}`));
}

function checkCallersOnly(
  facts: CheckFacts,
  check: Extract<ConstraintCheck, { rule: "callers-only" }>,
): CheckResult {
  const { target } = check;
  const known = new Set(facts.definedNames);
  const t = resolveTarget(facts, target);
  if (t.kind === "error") return { verdict: "unverifiable", reason: `${t.reason}. NOT treated as satisfied.`, offenders: [] };
  const def = t.kind === "project" ? t : { name: target, file: null };
  const calls: ReferenceFact[] = [
    // 2026-10-07 — bound to THIS definition (check_targets.ts), not by name
    ...facts.references.filter((r) => callReaches(r, def)),
    // An external API target (`lib.fn`, `*.fn`) counts its own call sites.
    ...(t.kind === "external"
      ? (facts.externalCalls ?? []).filter((c) => externalMatches(target, c.label))
        .map((c) => ({ fromFile: c.file, fromNodeId: c.nodeId, toFile: null, toName: target }))
      : []),
  ];
  const hidden = hiddenCandidates(facts, def.name);

  if (!known.has(def.name) && calls.length === 0) {
    return {
      verdict: "unverifiable",
      reason: `the IR knows no definition of \`${target}\` and no call to it — `
        + "the constraint may be about code that does not exist yet, or about a name "
        + "this project spells differently. NOT treated as satisfied.",
      offenders: [],
    };
  }

  const allowedFns = new Set(check.functions ?? []);
  const offenders: string[] = [];
  for (const c of calls) {
    // Files: exact, a folder (trailing /) or a glob; `allowTests` adds every test file.
    const fileOk = pathAllowed(c.fromFile, check.files ?? [], { allowTests: check.allowTests });
    const fn = enclosingFunction(c.fromNodeId);
    const fnOk = allowedFns.size > 0 && !!fn && allowedFns.has(fn);
    // A caller satisfies the rule when it is inside ANY allowed place. With
    // both lists given, either alone is enough: "only alerts.py, and only
    // should_notify" is two ways of saying where, not two hurdles.
    if (fileOk || fnOk) continue;
    offenders.push(`${c.fromFile}:${c.fromNodeId}`);
  }

  const where = [
    ...(check.files?.length || check.allowTests ? [`file(s) ${describeAllowList(check.files ?? [], check.allowTests)}`] : []),
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
  // 2026-10-07 (field report) — a project module may be named plainly
  // (`collect` for tools/collect.py, imported as `from collect import …`):
  // the one project module it names stands for it.
  const importersOf = (tool: string) => Object.entries(facts.importsByFile)
    .filter(([, tools]) => tools.includes(tool)).map(([file]) => file);
  let tool = check.tool;
  let importers = importersOf(tool);
  const named = modulesNamed(facts, check.tool);
  if (importers.length === 0 && named.length === 1 && named[0].module !== tool) {
    tool = named[0].module;
    importers = importersOf(tool);
  }
  const spelled = tool === check.tool ? `\`${check.tool}\`` : `\`${check.tool}\` (the project module ${tool})`;
  if (importers.length === 0) {
    // the module EXISTS and nothing imports it: the rule holds — that absence
    // is what it asks for. Only a module VibeGraph cannot find is unverifiable.
    if (named.length === 1) {
      return {
        verdict: "pass",
        reason: `satisfied: ${spelled} exists (${named[0].file}) and no file outside ${describeAllowList(check.files, check.allowTests)} imports it — no file imports it at all`,
        offenders: [],
      };
    }
    const alternatives = named.length > 1
      ? ` Several project modules are called that: ${named.map((m) => `\`${m.module}\``).join(", ")} — name one.`
      : suggestImport(facts, check.tool);
    return {
      verdict: "unverifiable",
      reason: `no file in the IR imports \`${check.tool}\` — the constraint may be about a `
        + `tool this project does not use yet.${alternatives} NOT treated as satisfied.`,
      offenders: [],
    };
  }
  // Files: exact, a folder (trailing /) or a glob; `allowTests` adds every test file.
  const offenders = importers.filter((f) => !pathAllowed(f, check.files, { allowTests: check.allowTests }));
  if (offenders.length) {
    return {
      verdict: "violated",
      reason: `${spelled} is imported outside ${describeAllowList(check.files, check.allowTests)}: ${offenders.join(", ")}.`,
      offenders,
    };
  }
  return {
    verdict: "pass",
    reason: `${spelled} is imported only in ${importers.join(", ")}`,
    offenders: [],
  };
}

/** "did you mean `tools.collect`? 3 files import it" — the imported names
 *  that end with, or contain, what was asked for. */
function suggestImport(facts: CheckFacts, asked: string): string {
  const counts = new Map<string, number>();
  for (const tools of Object.values(facts.importsByFile)) for (const t of new Set(tools)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const near = [...counts].filter(([t]) => t !== asked && (t.endsWith(`.${asked}`) || t.endsWith(`/${asked}`) || t.includes(asked)))
    .sort((a, b) => b[1] - a[1]).slice(0, 3);
  return near.length ? ` Did you mean ${near.map(([t, n]) => `\`${t}\` (${n} file${n === 1 ? "" : "s"} import it)`).join(" or ")}?` : "";
}

/** Evaluate one constraint's structured half against the project's facts. */
export function checkConstraint(facts: CheckFacts, check: ConstraintCheck): CheckResult {
  switch (check.rule) {
    case "import-only": return checkImportOnly(facts, check);
    case "calls-through": return checkCallsThrough(facts, check);
    case "callers-only": return checkCallersOnly(facts, check);
    case "payload-keys": return checkPayloadKeys(facts.callSites, check);
    case "layer": return checkLayer(facts, check);
    case "single-writer": return "writes" in check ? checkSingleWriter(facts, check) : checkTopology(facts.topology, check);
    case "writer-subset": case "no-write": return checkTopology(facts.topology, check);
    case "always-with": return checkAlwaysWith(facts, check);
    case "id-scheme": return checkIdScheme(facts, check);
  }
}

/** One line per constraint, for a pre-check trail a human can read. */
export function describeCheck(check: ConstraintCheck): string {
  switch (check.rule) {
    case "callers-only": {
      const where = [
        ...(check.files?.length || check.allowTests ? [describeAllowList(check.files ?? [], check.allowTests)] : []),
        ...(check.functions?.length ? [check.functions.join(", ")] : []),
      ].join(" or ");
      return `callers of \`${check.target}\` only in ${where}`;
    }
    case "import-only":
      return `\`${check.tool}\` imported only in ${describeAllowList(check.files, check.allowTests)}`;
    case "calls-through":
      return `every call to \`${check.target}\` goes through \`${check.through}\``;
    case "payload-keys":
      return describePayloadKeys(check);
    case "layer":
      return describeLayer(check);
    case "single-writer":
      return "writes" in check ? describeAuthority(check) : describeTopologyCheck(check);
    case "always-with": case "id-scheme":
      return describeAuthority(check);
    case "writer-subset": case "no-write":
      return describeTopologyCheck(check);
  }
}
