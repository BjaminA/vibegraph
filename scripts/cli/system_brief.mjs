// `vibegraph-knowledge brief codebase` (2026-10-08) — the Brief: one model call that
// writes the system's spec (function / method / key features), group changes,
// names, scopes for the boxes the code says little about, and a start-here
// path, every claim cited and vocabulary-checked, all PROPOSED until a person
// ratifies it (src/server/brief_*.ts).
//
//   brief codebase [<root>] [--estimate] [--dry-run] [--only spec|groups|scopes|path] [--reply <file>] [--model <m>] [--guidance "<text>"]
//   brief codebase show [<root>]
//   brief codebase ratify|reject [<section>] [<root>]      a person's step
//
// THE ONE TOKEN-SPENDING STEP is the draft; it says so, and --estimate says
// how much first. (`brief <entry id>` is the thread brief, brief.mjs.)
// --only scopes runs the silent boxes not yet scoped, one
// batch per call, adding to the pending brief.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildCrossingIndex } from "../../src/server/crossings.ts";
import { archModelForEnvelope } from "../../src/server/arch_envelope.ts";
import { briefInputs, briefEstimate } from "../../src/server/brief_inputs.ts";
import { buildBriefPrompt } from "../../src/server/brief_prompt.ts";
import { parseBrief } from "../../src/server/brief_validate.ts";
import { loadBrief, saveBrief, proposeBrief, decideBrief, sectionSummary, briefWithStaleness, allLines } from "../../src/server/brief_store.ts";
import { BRIEF_SECTIONS } from "../../src/shared/brief_types.ts";
import { personName } from "../../src/server/person.ts";
import { spawnClassifier } from "./classify.mjs";
import { cliPath } from "./winpath.mjs";

export const SYSTEM_BRIEF_USAGE = `brief codebase [<root>] [--estimate] [--dry-run] [--only spec|groups|scopes|path] [--stale] [--reply <file>]   THE BRIEF: one model call (SPENDS TOKENS;
                                  --estimate says how many first) writes the system's function / method / key features,
                                  group changes, names, scopes and a start-here path — cited, vocabulary-checked, PROPOSED
      brief codebase show [<root>]                      the pending brief and the ratified one (STALE lines marked)
      brief codebase ratify|reject [spec|groups|scopes|path] [<root>]   a person decides (all sections when none is named)`;

const ONLY = ["spec", "groups", "scopes", "path"];

export function runSystemBrief({ root, sub, section, values, pipeline, env = process.env }) {
  const absRoot = resolve(cliPath(root ?? "."));
  const lines = [], messages = [];
  const done = (exitCode = 0) => ({ lines, messages, exitCode });

  if (sub === "ratify" || sub === "reject") {
    if (section && !BRIEF_SECTIONS.includes(section)) { messages.push(`no section ${section} — one of ${BRIEF_SECTIONS.join(", ")}`); return done(2); }
    const r = decideBrief(absRoot, section ?? "all", sub, personName(absRoot));
    (r.ok ? lines : messages).push(r.detail);
    return done(r.ok ? 0 : 1);
  }

  const { envelope } = loadEnvelope(absRoot, values.envelope, pipeline ?? {}, { cache: true });
  const model = archModelForEnvelope(envelope, buildStackIndex(envelope, absRoot), buildCrossingIndex(envelope), absRoot);

  if (sub === "show") {
    const rec = loadBrief(absRoot);
    if (rec.proposed) {
      lines.push(`PROPOSED (from ${rec.proposed.model}, ${rec.proposed.at.slice(0, 16)}):`);
      for (const s of BRIEF_SECTIONS) { const t = sectionSummary(rec.proposed, s); if (t) lines.push(`  ${s}: ${t}`); }
      for (const l of allLines(rec.proposed.spec)) lines.push(`    [${l.words.join(", ")}] ${l.text}${l.cites.length ? "" : " (INFERRED)"}`);
      if (rec.proposed.refused.length) lines.push(`  refused: ${rec.proposed.refused.length} item(s) — ${rec.proposed.refused.slice(0, 3).map((r) => `${r.item}: ${r.reason}`).join("; ")}`);
      lines.push("  decide: vibegraph-knowledge brief codebase ratify|reject [spec|groups|scopes|path]  (or the inbox)");
    }
    const r = briefWithStaleness(rec, briefInputs(absRoot, model).facts);
    if (r?.spec) {
      lines.push(`RATIFIED (by ${r.by}, ${r.at.slice(0, 10)}, from ${r.model}):`);
      for (const [t, part] of [["Function", "function"], ["Method", "method"], ["Key features", "feature"]]) {
        for (const l of r.spec[part]) lines.push(`  ${t}: ${l.text}${l.stale?.length ? `  [STALE: ${l.stale.join(", ")} changed]` : ""}`);
      }
    }
    if (!rec.proposed && !r?.spec) lines.push("no brief yet — `vibegraph-knowledge brief codebase --estimate`, then `vibegraph-knowledge brief codebase`");
    return done(0);
  }

  const only = values.only;
  if (only && !ONLY.includes(only)) { messages.push(`--only takes ${ONLY.join(", ")}`); return done(2); }
  if (values.estimate && !values.stale) {
    const e = briefEstimate(absRoot, model);
    lines.push(`a full brief: ≈ ${e.calls} call${e.calls === 1 ? "" : "s"}, ~${Math.round(e.tokens / 1000)}k input tokens (${e.silent} silent box(es) to scope); the reply adds a few thousand`);
    return done(0);
  }
  const rec = loadBrief(absRoot);
  const inp = briefInputs(absRoot, model, { only: values.stale ? "spec" : only, pending: rec.proposed });
  for (const e of inp.errors) messages.push(`vocabulary: ${e}`);
  if (only === "scopes" && !inp.facts.silent.length) { lines.push("every silent box is scoped already (pending or ratified)"); return done(0); }
  // --stale: re-brief only the ratified lines whose citations changed (a small call)
  let restate;
  if (values.stale) {
    const r = briefWithStaleness(rec, inp.facts);
    restate = r?.spec ? allLines(r.spec).filter((l) => l.stale?.length).map((l) => l.text) : [];
    if (!restate.length) { lines.push("no ratified line of the Brief is stale"); return done(0); }
    if (values.estimate) {
      lines.push(`re-briefing ${restate.length} stale line${restate.length === 1 ? "" : "s"}: 1 call, ~${Math.round(inp.facts.estimate / 1000)}k input tokens (the facts are sent whole); the reply is a few lines`);
      return done(0);
    }
  }
  const prompt = buildBriefPrompt(inp.facts, inp.vocab, inp.opVocab, { only: restate ? "spec" : only, guidance: values.guidance, restate });
  if (values["dry-run"]) { lines.push(prompt); return done(0); }
  let text, label = "saved reply";
  if (values.reply) text = readFileSync(resolve(values.reply), "utf-8");
  else {
    messages.push(`asking a model — this SPENDS TOKENS: ~${Math.round(inp.facts.estimate / 1000)}k input tokens, ${inp.facts.boxes.size} boxes, ${inp.facts.silent.length} silent box(es) to scope`);
    const r = spawnClassifier({ prompt, model: values.model, cwd: absRoot, env });
    if (!r.ok) { messages.push(r.error); return done(3); }
    text = r.text; label = r.model;
  }
  const parsed = parseBrief(text, inp.facts, inp.vocab, inp.opVocab, { model: label, only: restate ? "spec" : only });
  if (!parsed.brief) { messages.push(parsed.error ?? "the reply was not a usable brief"); return done(3); }
  if (restate) parsed.brief.restates = restate;
  const next = proposeBrief(rec, parsed.brief, restate ? "spec" : only);
  if (restate && next.proposed) next.proposed.restates = restate;
  saveBrief(absRoot, next);
  const p = next.proposed;
  lines.push(`brief PROPOSED in .vibegraph/brief.json (from ${label}):`);
  for (const s of BRIEF_SECTIONS) { const t = sectionSummary(p, s); if (t) lines.push(`  ${s}: ${t}`); }
  for (const l of allLines(parsed.brief.spec)) lines.push(`    [${l.words.join(", ")}] ${l.text}${l.cites.length ? ` (${l.cites.length} citation${l.cites.length === 1 ? "" : "s"})` : " (INFERRED — no citation)"}`);
  if (parsed.brief.refused.length) lines.push(`  refused ${parsed.brief.refused.length}: ${parsed.brief.refused.slice(0, 5).map((r) => `${r.item}: ${r.reason}`).join("; ")}`);
  if (parsed.brief.omitted.length) lines.push(`  left out: ${parsed.brief.omitted.slice(0, 4).join("; ")}`);
  if (inp.facts.silentRest.length && only !== "scopes") lines.push(`  ${inp.facts.silentRest.length} silent box(es) left for \`brief --only scopes\``);
  lines.push("  decide: vibegraph-knowledge brief codebase ratify|reject [section], or the inbox — a person's step");
  return done(0);
}
