// `inbox` — every decision that waits for a person, in one list (2026-10-06,
// direction review M11): plan proposals, a proposed objective, rule changes,
// rules an agent stated, a groups proposal, scopes, skill and spec drafts, and
// questions at the cap. `inbox agree|reject <id>…` decides them through each
// store's own operation — a person's step, refused when Claude Code runs it.
// Zero tokens.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { cliPath } from "./winpath.mjs";
import { buildInbox, decideInbox } from "../../src/server/inbox.ts";

export const INBOX_USAGE = `inbox [--json] [--quick] | inbox agree|reject <id>… | inbox agree|reject --kind <kind>   [--root <dir>]
                                  every decision waiting for a person — plan proposals, rule changes, rules an agent
                                  stated, groups, scopes, skill and spec drafts — and agree / reject (a person's step)`;

// the derived map and the plan reconcile — the sensors read both; ratifying
// groups records what the map holds now, as architecture --ratify does
async function mapFor(root) {
    const { loadEnvelope } = await import("../quality_check.mjs");
    const { pipelineHere } = await import("./pipeline.mjs");
    const { buildStackIndex } = await import("../../src/server/stack.ts");
    const { buildCrossingIndex } = await import("../../src/server/crossings.ts");
    const { archModelForEnvelope } = await import("../../src/server/arch_envelope.ts");
    const { applyArchStore } = await import("../../src/server/arch_store.ts");
    const { archBaseline } = await import("../../src/server/arch_drift.ts");
    const { readInfraManifests } = await import("../../src/server/infra_manifests.ts");
    const { loadPlan } = await import("../../src/server/plan_store.ts");
    const { reconcilePlan } = await import("../../src/server/plan_reconcile.ts");
    const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
    const stack = buildStackIndex(envelope, root);
    const model = archModelForEnvelope(envelope, stack, buildCrossingIndex(envelope), root, undefined, { applyStore: false });
    const plan = loadPlan(root);
    return {
      model,
      rec: () => { const p = loadPlan(root); return p ? reconcilePlan(p, envelope, stack, root) : null; },
      archBaseline: (store) => archBaseline(applyArchStore(model, store), readInfraManifests(root).facts, plan),
    };
}

export async function runInbox(args) {
  let parsed;
  try { parsed = parseArgs({ args, allowPositionals: true, options: { root: { type: "string" }, json: { type: "boolean" }, kind: { type: "string" }, quick: { type: "boolean" } } }); }
  catch (e) { return { exitCode: 2, text: `${e.message}\n\nusage: vibegraph-knowledge ${INBOX_USAGE}\n` }; }
  const root = resolve(cliPath(parsed.values.root ?? "."));
  const [sub, ...ids] = parsed.positionals;
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  // --quick skips parsing the project: no sensor that reads the code's map
  let map = null;
  if (!parsed.values.quick) {
    try { map = await mapFor(root); }
    catch (e) { process.stderr.write(`inbox: the code's map could not be built (${e.message}) — the sensors that read it are off\n`); }
  }
  const items = buildInbox(root, map ? { model: map.model, rec: map.rec() } : {});
  if (!sub || sub === "list") {
    if (parsed.values.json) return done(JSON.stringify({ items }, null, 2));
    const decidable = items.filter((i) => i.decidable);
    if (!items.length) return done("Nothing waits for a decision.");
    const lines = [`${decidable.length} decision${decidable.length === 1 ? " waits" : "s wait"} for a person${items.length > decidable.length ? ` (and ${items.length - decidable.length} to look at)` : ""}:`, ""];
    for (const i of items) {
      lines.push(`${i.decidable ? "•" : "·"} ${i.id} — ${i.title}`);
      for (const d of i.detail.slice(0, 4)) lines.push(`    ${d}`);
    }
    lines.push("", "decide: vibegraph-knowledge inbox agree <id>… | inbox reject <id>…  (or --kind <kind> for every item of one kind)");
    return done(lines.join("\n"), decidable.length ? 1 : 0);
  }
  if (sub !== "agree" && sub !== "reject") return done(`usage: vibegraph-knowledge ${INBOX_USAGE}`, 2);
  const chosen = parsed.values.kind ? items.filter((i) => i.decidable && i.kind === parsed.values.kind).map((i) => i.id) : ids;
  if (!chosen.length) return done(parsed.values.kind ? `nothing of kind ${parsed.values.kind} waits` : `usage: vibegraph-knowledge inbox ${sub} <id>…`, parsed.values.kind ? 0 : 2);
  const out = [];
  let failed = 0;
  for (const id of chosen) {
    const r = decideInbox(root, id, sub, map ? { archBaseline: map.archBaseline, model: map.model, rec: map.rec() } : {});
    if (!r.ok) failed++;
    out.push(`${r.ok ? "✓" : "✗"} ${id}: ${r.detail}`);
  }
  out.push(`(by whoever ran this command)`);
  return done(out.join("\n"), failed ? 1 : 0);
}
