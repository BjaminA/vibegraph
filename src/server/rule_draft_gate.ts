// RULES PROPOSED FROM THE ARCHITECTURE — the gate (2026-10-19, PLAN-M-RULES
// M2). The arch_propose rule applied to rules: a model's proposal is stored
// only on evidence, and only as a proposal.
//
//   - a cite that is not a dossier id is dropped; a rule left citing nothing
//     it was shown is refused — it is listed as "without evidence", never stored;
//   - a scope token the project does not spell (an entry point id, a parsed
//     file or folder, a tool the stack index knows) is dropped; a rule whose
//     scope is left naming nothing is refused;
//   - a malformed check is removed (said in the note); a valid one is RUN
//     against the code first — VIOLATED is kept and labelled (that is a
//     finding about the code), UNVERIFIABLE is removed and said;
//   - a restatement of a stated rule (its text, or the same check) is refused;
//   - the rule's CLAIMS about the code are decided first (rule_draft_claims.ts):
//     a verified claim is stored as a check clause, a contradicted one is
//     corrected from the code or narrowed, or the rule is refused (RC1);
//   - survivors are stored AGENT-STATED, the facts they rest on in the note
//     and a harvested sentence as the rule's `cite`, and wait for a person.

import { addConstraint, findDuplicate, validateConstraintInput, type Constraint, type ConstraintInput } from "./constraint_store.ts";
import { proposeConstraintEdit } from "./constraint_edit.ts";
import { MAX_DRAFT_RULES, type RuleDossier } from "./rule_draft.ts";
import { jsonObjectInReply } from "./json_reply.ts";
import { gateClaims } from "./rule_draft_claims.ts";
import { funnelChecks, trivialCheck, type FunnelLike } from "./funnel_checks.ts";
import type { ClaimFacts } from "./rule_claims.ts";

export interface DraftCheckVerdict { verdict: "pass" | "violated" | "unverifiable"; reason: string; offenders: string[] }
export interface GateContext {
  existing: Constraint[];
  files: ReadonlySet<string>;
  entryPoints: ReadonlySet<string>;
  tools: ReadonlySet<string>;
  /** runs one candidate's check against the code (checkStatedRules); absent = not run */
  checkOne?: (input: ConstraintInput) => DraftCheckVerdict[];
  /** the facts a rule's claims are decided on (claimFactsFor); absent = claims not decided, said */
  claims?: ClaimFacts;
  /** RC4 — the project's funnels, with what each calls: a rule resting on one is checked by it */
  funnels?: FunnelLike[];
  stack?: Parameters<typeof trivialCheck>[1];
  model: string;
}
export interface GatedRule { input: ConstraintInput; cites: string[]; verdict: DraftCheckVerdict["verdict"] | null; notes: string[] }
export interface GateResult {
  accepted: GatedRule[];
  refused: Array<{ text: string; reason: string }>;
  withoutEvidence: string[];
  /** a restatement that brings a decidable check the stated rule lacks: proposed ON that rule */
  checkProposals: Array<{ id: string; check: Record<string, unknown>; verdict: DraftCheckVerdict["verdict"] | null; why: string }>;
  error?: string;
}

const KINDS = new Set(["invariant", "proxy", "payload-schema", "backend-call", "perf-lever", "objective"]);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);
/** key order is not meaning: {"tool","rule"} and {"rule","tool"} are one check */
const canon = (x: unknown): string => (Array.isArray(x) ? `[${x.map(canon).join(",")}]`
  : x && typeof x === "object" ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(x));
const checksOf = (c: Pick<Constraint, "check" | "checks">) => [...(c.checks ?? []), ...(c.check ? [c.check] : [])].map(canon);

/** A model's check, with empty optional fields removed: `"forbid": []` means
 *  none (a live run's payload check was refused for exactly that). */
function tidyCheck(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => !(Array.isArray(v) && !v.length) && v !== "" && v !== null));
}

/** The JSON object in a model's reply (a fenced block, or the outermost braces). */
export function replyJson(text: string): unknown {
  return jsonObjectInReply(text);
}

export function gateRuleDraft(reply: string, dossier: RuleDossier, ctx: GateContext): GateResult {
  const parsed = replyJson(reply) as { rules?: unknown; withoutEvidence?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.rules)) return { accepted: [], refused: [], withoutEvidence: [], checkProposals: [], error: "the reply is not the JSON object the prompt asks for ({\"rules\": [...]})" };
  const ids = new Map(dossier.items.map((i) => [i.id, i]));
  const accepted: GatedRule[] = [];
  const refused: GateResult["refused"] = [];
  const checkProposals: GateResult["checkProposals"] = [];
  const withoutEvidence = list(parsed.withoutEvidence);
  const known = (f: string) => ctx.files.has(f) || (f.endsWith("/") && [...ctx.files].some((p) => p.startsWith(f)));
  for (const raw of parsed.rules.slice(0, MAX_DRAFT_RULES * 2) as Array<Record<string, any>>) {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!text) continue;
    if (accepted.length >= MAX_DRAFT_RULES) { refused.push({ text, reason: `over the ${MAX_DRAFT_RULES}-rule limit` }); continue; }
    const kind = KINDS.has(raw.kind) ? raw.kind : "invariant";
    const notes: string[] = [];
    // evidence
    const cites = list(raw.cites).filter((c) => ids.has(c));
    const invented = list(raw.cites).filter((c) => !ids.has(c));
    if (!cites.length) { refused.push({ text, reason: invented.length ? `cites nothing it was shown (${invented.slice(0, 3).join(", ")})` : "cites no fact" }); withoutEvidence.push(text); continue; }
    if (invented.length) notes.push(`dropped cite(s) not shown: ${invented.slice(0, 3).join(", ")}`);
    // scope, in the project's own spellings
    const s = raw.scope ?? {};
    let scope: Record<string, unknown> = s.all === true ? { all: true } : {
      ...(list(s.entryPointIds).filter((e) => ctx.entryPoints.has(e)).length ? { entryPointIds: list(s.entryPointIds).filter((e) => ctx.entryPoints.has(e)) } : {}),
      ...(list(s.files).filter(known).length ? { files: list(s.files).filter(known) } : {}),
      ...(list(s.stack).filter((t) => ctx.tools.has(t)).length ? { stack: list(s.stack).filter((t) => ctx.tools.has(t)) } : {}),
    };
    const unknownScope = [...list(s.entryPointIds).filter((e) => !ctx.entryPoints.has(e)), ...list(s.files).filter((f) => !known(f)), ...list(s.stack).filter((t) => !ctx.tools.has(t))];
    if (!Object.keys(scope).length) { refused.push({ text, reason: `its scope names nothing this project has${unknownScope.length ? ` (${unknownScope.slice(0, 3).join(", ")})` : ""}` }); continue; }
    if (unknownScope.length) notes.push(`dropped from the scope: ${unknownScope.slice(0, 3).join(", ")}`);
    // the sentence it rests on, when one of the facts is a harvested sentence
    const harvested = cites.map((c) => ids.get(c)!.cite).find(Boolean);
    const why = typeof raw.why === "string" && raw.why.trim() ? raw.why.trim() : "";
    const check = raw.check && typeof raw.check === "object" && !Array.isArray(raw.check) ? tidyCheck(raw.check) : null;
    // what the rule claims the code does, decided before anything else is
    const claimed = gateClaims(raw.claims, text, why, ctx.claims, !!check && !!Object.keys(check).length);
    if (claimed.refuse) { refused.push({ text, reason: claimed.refuse }); continue; }
    notes.push(...claimed.notes);
    if (claimed.narrowedFiles) scope = { ...scope, files: claimed.narrowedFiles };
    const base = { kind, text: why ? `${claimed.text} (why: ${why})` : claimed.text, scope, ...(harvested ? { cite: harvested } : {}) };
    // the checkable half: well-formed, then decided against the code
    let input: ConstraintInput | null = null;
    let verdict: GatedRule["verdict"] = null;
    if (check && Object.keys(check).length) {
      const v = validateConstraintInput({ ...base, check });
      if (v.ok) {
        const results = ctx.checkOne ? ctx.checkOne(v.value) : [];
        const worst = results.find((r) => r.verdict === "violated") ?? results.find((r) => r.verdict === "unverifiable") ?? results[0];
        if (worst?.verdict === "unverifiable") notes.push(`its check was removed: it cannot be decided on this code (${worst.reason.slice(0, 120)})`);
        else { input = v.value; verdict = worst?.verdict ?? null; if (worst?.verdict === "violated") notes.push(`VIOLATED on the current code: ${worst.offenders.slice(0, 2).join(", ") || worst.reason.slice(0, 100)}`); }
      } else notes.push(`its check was removed: ${/^check must be one of/.test(v.error) ? `not one of the grammar's shapes (${String(check.rule ?? "no rule")})` : v.error.slice(0, 100)}`);
    }
    if (!input) {
      const v = validateConstraintInput(base);
      if (!v.ok) { refused.push({ text, reason: v.error }); continue; }
      input = v.value;
    }
    // RC4 — a rule resting on a funnel is checked by what the funnel calls,
    // unless the model's check already can catch a bypass (funnel_checks.ts)
    const funnel = cites.map((c) => /^funnel:(.+)$/.exec(c)?.[1]).map((t) => ctx.funnels?.find((f) => f.tool === t)).find(Boolean);
    if (funnel) {
      const trivial = input.check ? trivialCheck(input.check, ctx.stack) : null;
      if (!input.check || trivial) {
        const { check: modelCheck, ...rest } = input;
        const exceptions = ((modelCheck as { files?: string[] } | undefined)?.files ?? []).filter((f) => f !== funnel.home);
        const decided = funnelChecks(funnel, exceptions, ctx.stack).map((d) => ({ d, r: ctx.checkOne ? ctx.checkOne({ ...rest, check: d } as ConstraintInput) : [] }))
          .filter(({ r }) => !r.some((x) => x.verdict === "unverifiable"));
        const v = decided.length ? validateConstraintInput(decided.length === 1 ? { ...rest, check: decided[0].d } : { ...rest, checks: decided.map((x) => x.d) }) : null;
        if (v?.ok) {
          input = v.value;
          verdict = decided.some(({ r }) => r.some((x) => x.verdict === "violated")) ? "violated" : "pass";
          notes.push(trivial ? `its check was replaced: ${trivial}; it is checked by what the funnel calls instead` : "its check comes from what the funnel calls");
        } else if (trivial) notes.push(`its check cannot catch a bypass: ${trivial}`);
      }
    }
    if (claimed.clauses.length) {
      const { check: one, ...rest } = input;
      const v = validateConstraintInput({ ...rest, checks: [...(one ? [one] : []), ...claimed.clauses] });
      if (v.ok) { input = v.value; verdict ??= "pass"; } else notes.push(`its claims were not stored as checks: ${v.error.slice(0, 100)}`);
    }
    // a restatement, by text or by check
    const pool = [...ctx.existing, ...accepted.map((a, i) => ({ ...a.input, id: `new${i + 1}` } as Constraint))];
    // the grammar check, wherever the claims put it (`checks` once a claim rides along)
    const own = input.check ?? input.checks?.find((c) => (c as { rule?: string }).rule !== "claim");
    const twin = findDuplicate(pool, text) ?? (own ? pool.find((c) => checksOf(c).includes(canon(own))) : undefined);
    if (twin) {
      // M3 (both writers on one tree): the prose writer stated the rule without a check, and the
      // architecture writer's restatement — refused — took its check with it. A restatement that
      // brings a decidable check the stated rule lacks is proposed ON that rule instead.
      const stated = ctx.existing.some((c) => c.id === twin.id);
      if (stated && own && !checksOf(twin).length && verdict !== null) {
        checkProposals.push({ id: twin.id, check: own as Record<string, unknown>, verdict, why: `proposed from the architecture (${ctx.model.slice(0, 40)}); rests on ${cites.slice(0, 4).join(", ")}; ${verdict === "violated" ? "VIOLATED" : "passes"} on the current code` });
        refused.push({ text, reason: `restates ${twin.id} — its check is proposed for ${twin.id} instead` });
      } else refused.push({ text, reason: `restates ${twin.id}` });
      continue;
    }
    // the note has 300 characters: the evidence capped, so what the gate did is never the part cut off
    const rests = `${cites.slice(0, 4).join(", ")}${cites.length > 4 ? ` +${cites.length - 4}` : ""}`;
    const said = notes.length ? ` — ${notes.join("; ")}` : "";
    input.note = `proposed from the architecture (${ctx.model.slice(0, 40)}); rests on ${rests}${said}`.slice(0, 300);
    accepted.push({ input, cites, verdict, notes });
  }
  // the deliberate channel: a check for a stated rule that has none (`checks` in the reply)
  for (const raw of (Array.isArray((parsed as { checks?: unknown }).checks) ? (parsed as { checks: Array<Record<string, any>> }).checks : []).slice(0, MAX_DRAFT_RULES)) {
    const id = typeof raw?.for === "string" ? raw.for : "";
    const label = `a check for ${id || "an unnamed rule"}`;
    const target = ctx.existing.find((c) => c.id === id);
    if (!target) { refused.push({ text: label, reason: "names no stated rule" }); continue; }
    if (checksOf(target).length) { refused.push({ text: label, reason: `${id} already has a check` }); continue; }
    const cites = list(raw.cites).filter((c) => ids.has(c));
    if (!cites.length) { refused.push({ text: label, reason: "cites nothing it was shown" }); continue; }
    const check = raw.check && typeof raw.check === "object" && !Array.isArray(raw.check) ? tidyCheck(raw.check) : null;
    const v = check ? validateConstraintInput({ kind: target.kind, text: target.text, scope: target.scope, check }) : null;
    if (!v || !v.ok) { refused.push({ text: label, reason: `not one of the grammar's shapes (${String(check?.rule ?? "no rule")})` }); continue; }
    const results = ctx.checkOne ? ctx.checkOne(v.value) : [];
    const worst = results.find((r) => r.verdict === "violated") ?? results.find((r) => r.verdict === "unverifiable") ?? results[0];
    if (worst?.verdict === "unverifiable") { refused.push({ text: label, reason: `it cannot be decided on this code (${worst.reason.slice(0, 100)})` }); continue; }
    if (checkProposals.some((p) => p.id === id)) continue;
    checkProposals.push({ id, check: v.value.check as Record<string, unknown>, verdict: worst?.verdict ?? null, why: `proposed from the architecture (${ctx.model.slice(0, 40)}); rests on ${cites.slice(0, 4).join(", ")}; ${worst?.verdict === "violated" ? "VIOLATED" : "passes"} on the current code` });
  }
  return { accepted, refused, withoutEvidence: [...new Set(withoutEvidence)], checkProposals };
}

/** Store the survivors, agent-stated, and propose each found check on the
 *  rule it belongs to: a person ratifies, accepts or removes every one. */
export function applyRuleDraft(root: string, gated: GateResult): string[] {
  const ids = gated.accepted.map((g) => addConstraint(root, g.input, "agent").id);
  for (const p of gated.checkProposals) {
    const r = proposeConstraintEdit(root, p.id, { check: p.check }, { by: "agent", why: p.why });
    if (r.proposal) ids.push(`${p.id}/${r.proposal.id}`);
  }
  return ids;
}

export function formatRuleDraftReport(gated: GateResult, stored: string[] | null): string {
  const L: string[] = [];
  if (gated.error) return `${gated.error}\n`;
  const ruleIds = stored?.slice(0, gated.accepted.length) ?? null;
  const proposalIds = stored?.slice(gated.accepted.length) ?? [];
  L.push(`${gated.accepted.length} rule(s) proposed${ruleIds ? ` and stored agent-stated (${ruleIds.join(", ")}) — a person ratifies or removes each (Rules panel, Awaiting you; or \`constraints ratify|remove <id>\`)` : " (nothing written)"}`);
  if (gated.checkProposals.length) L.push(`${gated.checkProposals.length} check(s) proposed ON stated rules${proposalIds.length ? ` (${proposalIds.join(", ")})` : ""} — a person accepts or rejects each (\`constraint accept|reject <id> <pN>\`): ${gated.checkProposals.map((p) => `${p.id} ← ${JSON.stringify(p.check)}`).join("; ")}`);
  gated.accepted.forEach((g, i) => {
    L.push(`  ${stored?.[i] ?? `+${i + 1}`} [${g.input.kind}] ${g.input.text}`);
    const shown = g.input.check ? [g.input.check] : g.input.checks ?? [];
    L.push(`      scope ${JSON.stringify(g.input.scope)}${shown.length ? ` · check ${shown.map((c) => JSON.stringify(c)).join(" + ")}${g.verdict ? ` → ${g.verdict.toUpperCase()}` : ""}` : ""}`);
    L.push(`      rests on ${g.cites.join(", ")}${g.input.cite ? ` · from ${g.input.cite.file}:${g.input.cite.line}` : ""}`);
    for (const n of g.notes) L.push(`      note: ${n}`);
  });
  if (gated.refused.length) { L.push(`${gated.refused.length} refused:`); for (const r of gated.refused) L.push(`  - "${r.text.slice(0, 100)}" — ${r.reason}`); }
  if (gated.withoutEvidence.length) { L.push(`without evidence (not stored — for a person to consider):`); for (const w of gated.withoutEvidence) L.push(`  - ${w.slice(0, 140)}`); }
  return L.join("\n") + "\n";
}
