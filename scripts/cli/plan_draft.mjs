// `plan draft --from <url|file>…` (2026-09-30): SPENDS TOKENS (one model call)
// and fetches the --from URLs. The plan's objective, the plan so far, every
// ratified software spec and the documents go to a model; its operations pass
// the citation gate (src/server/plan_draft.ts) and land PROPOSED — a person
// agrees to each. --dry-run prints the prompt and spends nothing; --reply uses
// a saved reply.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawnClassifier } from "./classify.mjs";
import { readFrom } from "./software.mjs";
import { cacheDirFor } from "../cache_dir.mjs";
import { loadPlan, savePlan } from "../../src/server/plan_store.ts";
import { ratifiedSpecs, readSources } from "../../src/server/software_store.ts";
import { buildPlanDraftPrompt, parsePlanDraftReply, gatePlanDraft, applyDraftOps } from "../../src/server/plan_draft.ts";
import { cliPath } from "./winpath.mjs";
import { projectProse, projectKnowledge, DIRECTION_HINT } from "./project_prose.mjs";

export async function runPlanDraft(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      root: { type: "string" }, from: { type: "string", multiple: true }, hint: { type: "string" },
      model: { type: "string" }, "dry-run": { type: "boolean" }, reply: { type: "string" }, direction: { type: "boolean" },
    } });
  } catch (e) { return { exitCode: 2, text: `${e.message}\n` }; }
  const root = resolve(cliPath(parsed.values.root ?? "."));
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  const plan = loadPlan(root);
  // a person starts a plan; a draft goes into one. Said with both ways in, so
  // a session does not reach for `plan init "placeholder"` (the live run did)
  if (!plan) return done(`no plan yet, and starting one is a person's step: \`vibegraph-knowledge plan observe\` (from the code, zero tokens — the objective is left for ${parsed.values.direction ? "this draft" : "a draft"}) or \`vibegraph-knowledge plan init "<objective>"\`; then run this again — nothing was spent`, 1);
  const docs = [];
  for (const ref of parsed.values.from ?? []) {
    const r = await readFrom(ref, root);
    if (r.error) return done(`could not read ${r.error}`, 1);
    docs.push({ ref, text: r.text });
  }
  // M2: the project's own prose, read here — no fetch, nothing outside the project
  if (parsed.values.direction) docs.push(...projectProse(root), ...projectKnowledge(root));
  const specs = ratifiedSpecs(root);
  if (!docs.length && !specs.length) return done(`plan draft needs --from <docs>${parsed.values.direction ? " (the project has no README, CLAUDE.md, HANDOVER.md, docs/ or commits to read)" : ""} (or a ratified software spec to plan with)`, 2);
  const hint = parsed.values.direction ? [DIRECTION_HINT, parsed.values.hint].filter(Boolean).join(" ") : parsed.values.hint;
  const prompt = buildPlanDraftPrompt(plan, specs, docs, hint);
  if (parsed.values["dry-run"]) return done(`(dry run — nothing spent, nothing saved)\n\n${prompt}`);
  let reply;
  if (parsed.values.reply) reply = readFileSync(resolve(parsed.values.reply), "utf-8");
  else {
    const r = spawnClassifier({ prompt, model: parsed.values.model, cwd: root });
    if (!r.ok) return done(`the model could not be run: ${r.error}`, 3);
    reply = r.text;
  }
  // a refused reply is KEPT, with the command that re-reads it for nothing
  const keep = (why) => {
    if (parsed.values.reply) return done(`refused: ${why}`, 1);
    const file = join(cacheDirFor(root), "plan-replies", `draft${parsed.values.direction ? "-direction" : ""}.txt`);
    try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, reply); } catch { return done(`refused: ${why}`, 1); }
    const again = args.map((a) => (/[\s'"]/.test(a) ? JSON.stringify(a) : a)).join(" ");
    return done(`refused: ${why}\nthe reply is kept: ${file}\nre-read it without spending: vibegraph-knowledge plan draft ${again ? `${again} ` : ""}--reply ${file}`, 1);
  };
  const p = parsePlanDraftReply(reply);
  if (p.error) return keep(p.error);
  // Quotes may come from the documents handed over, or from a spec's own sources.
  const texts = [...docs.map((d) => d.text), ...specs.flatMap((s) => readSources(root, s).map((t) => t.text ?? ""))];
  const g = gatePlanDraft(p.ops, texts);
  if (!g.ops.length) return keep(`nothing to add — every operation was refused:\n${g.dropped.map((d) => `  dropped: ${d}`).join("\n")}`);
  // item by item: one item the plan refuses is dropped and named, never the whole draft
  const r = applyDraftOps(plan, g.ops, "agent");
  if (!r.plan) return keep(`nothing written — the plan refused every item:\n${r.refused.map((x) => `  refused: ${x}`).join("\n")}`);
  const s = savePlan(root, r.plan);
  if (s.error) return done(`refused: ${s.error}`, 1);
  return done([
    `plan rev ${r.plan.revision}: ${r.applied.length} item(s) proposed — agree each in the Plan panel or with \`plan agree\``,
    `citation gate: ${g.dropped.length} dropped (quote not in the documents or specs), ${g.inferred.length} inferred (no quote)`,
    ...g.dropped.map((d) => `  dropped: ${d}`), ...g.inferred.map((d) => `  inferred: ${d}`),
    ...(r.refused.length ? [`the plan refused ${r.refused.length} item(s) (the rest were written):`, ...r.refused.map((x) => `  refused: ${x}`)] : []),
  ].join("\n"));
}
