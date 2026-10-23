// `constraints ledger` and `constraints restore` (2026-10-22, the root-cause
// handoff RC5). Zero tokens.
//
//   constraints ledger [<root>] [--json]
//       every rule sentence of a CLAUDE.md / AGENTS.md rule section, and what
//       became of it: ratified, proposed, merged, offered next, queued behind
//       a round's cap, or out of reach (src/server/rule_ledger.ts); and the
//       entries constraints.json holds that could not be read
//   constraints restore [<root>] [--all | --take 1,3]
//       the rules a person ratified before that constraints.json no longer
//       holds (the cache backup, or a copy beside it: src/server/rule_backup.ts),
//       listed; --all or --take puts them back as a person's, which is a
//       person's step (refused inside Claude Code, actor.mjs)
import { resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { harvestRules } from "../../src/server/rule_harvest.ts";
import { buildRuleLedger, formatRuleLedger } from "../../src/server/rule_ledger.ts";
import { backedUpRules } from "../../src/server/rule_backup.ts";
import { addConstraint, droppedConstraints, findDuplicate, loadConstraints, validateConstraintInput } from "../../src/server/constraint_store.ts";
import { cliPath } from "./winpath.mjs";

/** The ratified rules a backup holds that constraints.json does not. */
export function restorable(absRoot) {
  const now = loadConstraints(absRoot);
  return backedUpRules(absRoot).filter((r) => !findDuplicate(now, r.text));
}

export function runRuleLedgerCli({ root, sub, values, pipeline }) {
  const absRoot = resolve(cliPath(root ?? "."));
  if (sub === "ledger") {
    const { envelope } = loadEnvelope(absRoot, undefined, pipeline ?? {}, { cache: true });
    const ledger = buildRuleLedger(harvestRules(absRoot, envelope, buildStackIndex(envelope, absRoot)), loadConstraints(absRoot));
    const dropped = droppedConstraints(absRoot);
    if (values.json) return { lines: [JSON.stringify({ ...ledger, dropped }, null, 2)], messages: [], exitCode: 0 };
    const lines = [formatRuleLedger(ledger).trimEnd()];
    if (dropped.length) lines.push("", `constraints.json holds ${dropped.length} entr${dropped.length === 1 ? "y" : "ies"} this version could not read (kept in the file, used nowhere):`, ...dropped.map((d) => `- ${d.id ?? "(no id)"}${d.text ? ` "${d.text}"` : ""}: ${d.reason}`));
    const back = restorable(absRoot);
    if (back.length) lines.push("", `${back.length} rule${back.length === 1 ? "" : "s"} ratified before ${back.length === 1 ? "is" : "are"} not in constraints.json: \`constraints restore\` lists ${back.length === 1 ? "it" : "them"}`);
    return { lines, messages: [], exitCode: 0 };
  }
  // restore
  const back = restorable(absRoot);
  if (!back.length) return { lines: ["every rule ratified before is in constraints.json"], messages: [], exitCode: 0 };
  const take = values.all ? back.map((_, i) => i + 1) : String(values.take ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1);
  if (!take.length) {
    return {
      lines: [`${back.length} rule${back.length === 1 ? "" : "s"} ratified before, not in constraints.json:`, ...back.map((r, i) => `  ${i + 1}. [${r.kind}] ${r.text.slice(0, 200)} (from ${r.from}${r.savedAt ? `, ${r.savedAt.slice(0, 10)}` : ""})`), "put them back: `constraints restore --all`, or some: `--take 1,3` (a person's step)"],
      messages: [], exitCode: 0,
    };
  }
  const lines = [];
  for (const n of take) {
    const r = back[n - 1];
    if (!r) { lines.push(`${n}: no such entry`); continue; }
    const v = validateConstraintInput({ kind: r.kind, text: r.text, scope: r.scope, ...(r.check ? { check: r.check } : {}), ...(r.checks ? { checks: r.checks } : {}), ...(r.policy ? { policy: r.policy } : {}), ...(r.cite ? { cite: r.cite } : {}) });
    if (!v.ok) { lines.push(`${n}: not restored, this version cannot read it (${v.error})`); continue; }
    const c = addConstraint(absRoot, { ...v.value, note: `restored from ${r.from}${r.savedAt ? ` (ratified, saved ${r.savedAt.slice(0, 10)})` : ""}` }, "human");
    lines.push(`${n}: restored as ${c.id}`);
  }
  return { lines, messages: [], exitCode: 0 };
}
