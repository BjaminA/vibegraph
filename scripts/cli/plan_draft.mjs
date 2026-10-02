// `plan draft --from <url|file>…` (2026-09-30): SPENDS TOKENS (one model call)
// and fetches the --from URLs. The plan's objective, the plan so far, every
// ratified software spec and the documents go to a model; its operations pass
// the citation gate (src/server/plan_draft.ts) and land PROPOSED — a person
// agrees to each. --dry-run prints the prompt and spends nothing; --reply uses
// a saved reply.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawnClassifier } from "./classify.mjs";
import { readFrom } from "./software.mjs";
import { loadPlan, savePlan } from "../../src/server/plan_store.ts";
import { applyPlanOps } from "../../src/server/plan_ops.ts";
import { ratifiedSpecs, readSources } from "../../src/server/software_store.ts";
import { buildPlanDraftPrompt, parsePlanDraftReply, gatePlanDraft } from "../../src/server/plan_draft.ts";
import { cliPath } from "./winpath.mjs";

export async function runPlanDraft(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      root: { type: "string" }, from: { type: "string", multiple: true }, hint: { type: "string" },
      model: { type: "string" }, "dry-run": { type: "boolean" }, reply: { type: "string" },
    } });
  } catch (e) { return { exitCode: 2, text: `${e.message}\n` }; }
  const root = resolve(cliPath(parsed.values.root ?? "."));
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  const plan = loadPlan(root);
  if (!plan) return done("no plan yet — start one: vibegraph-knowledge plan init \"<objective>\"", 1);
  const docs = [];
  for (const ref of parsed.values.from ?? []) {
    const r = await readFrom(ref);
    if (r.error) return done(`could not read ${r.error}`, 1);
    docs.push({ ref, text: r.text });
  }
  const specs = ratifiedSpecs(root);
  if (!docs.length && !specs.length) return done("plan draft needs --from <docs> (or a ratified software spec to plan with)", 2);
  const prompt = buildPlanDraftPrompt(plan, specs, docs, parsed.values.hint);
  if (parsed.values["dry-run"]) return done(`(dry run — nothing spent, nothing saved)\n\n${prompt}`);
  let reply;
  if (parsed.values.reply) reply = readFileSync(resolve(parsed.values.reply), "utf-8");
  else {
    const r = spawnClassifier({ prompt, model: parsed.values.model, cwd: root });
    if (!r.ok) return done(`the model could not be run: ${r.error}`, 3);
    reply = r.text;
  }
  const p = parsePlanDraftReply(reply);
  if (p.error) return done(`refused: ${p.error}`, 1);
  // Quotes may come from the documents handed over, or from a spec's own sources.
  const texts = [...docs.map((d) => d.text), ...specs.flatMap((s) => readSources(root, s).map((t) => t.text ?? ""))];
  const g = gatePlanDraft(p.ops, texts);
  if (!g.ops.length) return done(`nothing to add — every operation was refused:\n${g.dropped.map((d) => `  dropped: ${d}`).join("\n")}`, 1);
  const r = applyPlanOps(plan, g.ops, "agent");
  if (r.error) return done(`refused, nothing written: ${r.error}`, 1);
  const s = savePlan(root, r.plan);
  if (s.error) return done(`refused: ${s.error}`, 1);
  return done([
    `plan rev ${r.plan.revision}: ${g.ops.length} item(s) proposed — agree each in the Plan panel or with \`plan agree\``,
    `citation gate: ${g.dropped.length} dropped (quote not in the documents or specs), ${g.inferred.length} inferred (no quote)`,
    ...g.dropped.map((d) => `  dropped: ${d}`), ...g.inferred.map((d) => `  inferred: ${d}`),
  ].join("\n"));
}
