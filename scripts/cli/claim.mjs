// `vibegraph-knowledge claim` (2026-10-08) — rung 3 of the run-time ladder, in
// session: what the code decides at run time (a facts gap on the map), said by
// the Claude already reading that code, checked like a Brief claim, and decided
// by a person (src/server/claim_store.ts). Zero tokens.
//
//   claim propose --subject <box> --verb <writes|reads|watches|creates|owns> --object <zone|family>
//                 --cite <file:line>… [--partition <key>]… [--not] [--why "<text>"] [<root>]
//   claim list [--json] [<root>]                 every claim, STALE ones marked
//   claim agree|reject <id> [<root>]             a person's step (refused under Claude Code)
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { cliPath } from "./winpath.mjs";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildCrossingIndex } from "../../src/server/crossings.ts";
import { archModelForEnvelope } from "../../src/server/arch_envelope.ts";
import { briefInputs } from "../../src/server/brief_inputs.ts";
import { linesReader } from "../../src/server/node_scope.ts";
import { personName } from "../../src/server/person.ts";
import { claimChanges, claimLabel, decideClaim, loadClaims, proposeClaim } from "../../src/server/claim_store.ts";
import { isAgentRun } from "./actor.mjs";
import { readFileSync } from "node:fs";
import { spawnClassifier } from "./classify.mjs";
import { gapDossier, gapList, gapPrompt, parseGapReply } from "../../src/server/gap_explain.ts";

export const CLAIM_USAGE = `claim propose --subject <box> --verb <writes|reads|watches|creates|owns> --object <zone|family> --cite <file:line>… [--partition <key>]… [--not] [--why "<text>"] [<root>]
                                  say what the code does at run time where the map cannot see it (a facts gap), citing the
                                  lines; checked against the map, stored PROPOSED · inferred for a person to agree (zero tokens)
      claim list [--json] [<root>]                     every claim, its status, STALE when a cited line changed
      claim gaps [<root>]                              the open facts gaps (the plan says it, the code does not show it)
      claim explain <n> [--estimate] [--dry-run] [--reply <file>] [<root>]   ONE model call (SPENDS TOKENS; --estimate
                                  first) reads the code around gap n and proposes a claim with its chain of cited lines
      claim agree|reject <id> [<root>]                 a person decides (also the inbox)`;

/** `claim gaps` / `claim explain <n>`: the open gaps, and one model call on one of them. */
function explainOrList(sub, pos, v, env, done) {
  const n = sub === "explain" ? Number(pos[0]) : null;
  if (sub === "explain" && !(n >= 1)) return done("claim explain needs a gap number (`claim gaps` lists them)", 2);
  const root = resolve(cliPath((sub === "explain" ? pos[1] : pos[0]) ?? "."));
  const readLines = linesReader(root);
  const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
  const model = archModelForEnvelope(envelope, buildStackIndex(envelope, root), buildCrossingIndex(envelope), root);
  const { facts } = briefInputs(root, model);
  const gaps = gapList(facts);
  const say = (g) => `${facts.labels.get(g.box) ?? g.box} ${({ watch: "watches", read: "reads", write: "writes", attempt: "writes" })[g.op] ?? g.op} ${g.zone.replace(/^zone:/, "")} (${g.cite})`;
  if (sub === "gaps") return done(gaps.length ? gaps.map((g, i) => `${i + 1}. ${say(g)}`).join("\n") : "no open facts gap: every planned step the code, a claim, a declared feed or a run answers");
  const gap = gaps[n - 1];
  if (!gap) return done(`no gap ${n} (there are ${gaps.length})`, 1);
  const d = gapDossier(model, facts, gap, readLines);
  if (v.estimate) return done(`explaining gap ${n} (${say(gap)}): 1 call, ~${Math.round(d.estimate / 1000)}k input tokens, ${d.shown.size} lines of code shown`);
  const prompt = gapPrompt(d);
  if (v["dry-run"]) return done(prompt);
  let text, label = "saved reply";
  if (v.reply) text = readFileSync(resolve(v.reply), "utf-8");
  else {
    process.stderr.write(`asking a model — this SPENDS TOKENS: ~${Math.round(d.estimate / 1000)}k input tokens\n`);
    const r = spawnClassifier({ prompt, model: v.model, cwd: root, env });
    if (!r.ok) return done(r.error, 3);
    text = r.text; label = r.model;
  }
  const parsed = parseGapReply(text, d);
  if (!parsed.ok) return done(`no claim: ${parsed.reason}`, 1);
  const r = proposeClaim(root, model, facts, readLines, { ...parsed.claim, cites: parsed.cites, why: `${parsed.why} (${label})`, by: "agent" });
  if (!r.ok) return done(`the model's claim was refused:\n${r.reasons.map((x) => `  - ${x}`).join("\n")}`, 1);
  return done(`claim ${r.claim.id} PROPOSED · inferred (from ${label}): ${claimLabel(r.claim, facts.labels)}\n  chain: ${r.claim.cites.join(" → ")}\n  a person decides: \`vibegraph-knowledge claim agree|reject ${r.claim.id}\`, or the inbox`);
}

export function runClaim(args, env = process.env) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      subject: { type: "string" }, verb: { type: "string" }, object: { type: "string" }, cite: { type: "string", multiple: true },
      partition: { type: "string", multiple: true }, not: { type: "boolean" }, why: { type: "string" }, json: { type: "boolean" },
      estimate: { type: "boolean" }, "dry-run": { type: "boolean" }, reply: { type: "string" }, model: { type: "string" },
    } });
  } catch (e) { return { exitCode: 2, text: `${e.message}\n\nusage: vibegraph-knowledge ${CLAIM_USAGE}\n` }; }
  const [sub, ...pos] = parsed.positionals;
  const v = parsed.values;
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  if (sub === "agree" || sub === "reject") {
    const [id, rootArg] = pos;
    if (!id) return done(`claim ${sub} needs a claim id (claim list)`, 2);
    const root = resolve(cliPath(rootArg ?? "."));
    const r = decideClaim(root, id, sub, personName(root));
    return done(r.detail, r.ok ? 0 : 1);
  }
  if (sub === "gaps" || sub === "explain") return explainOrList(sub, pos, v, env, done);
  const root = resolve(cliPath(pos[0] ?? "."));
  const readLines = linesReader(root);
  if (sub === "list") {
    const rec = loadClaims(root);
    if (v.json) return done(JSON.stringify(rec.claims.map((k) => ({ ...k, stale: claimChanges(k, readLines) })), null, 2));
    if (!rec.claims.length) return done("no claims yet — `claim propose` records what the code does at run time, citing the lines");
    const lines = [];
    for (const k of rec.claims) {
      const stale = claimChanges(k, readLines);
      lines.push(`${claimLabel(k)}  [${k.status}${k.status === "ratified" ? " · inferred" : ""}${stale.length ? " · STALE" : ""}] — ${k.cites.join(", ")}`);
      for (const s of stale) lines.push(`    STALE: ${s}`);
    }
    return done(lines.join("\n"));
  }
  if (sub !== "propose") return done(`usage: vibegraph-knowledge ${CLAIM_USAGE}`, 2);
  if (!v.subject || !v.verb || !v.object) return done("claim propose needs --subject, --verb and --object", 2);
  const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
  const model = archModelForEnvelope(envelope, buildStackIndex(envelope, root), buildCrossingIndex(envelope), root);
  const { facts } = briefInputs(root, model);
  const r = proposeClaim(root, model, facts, readLines, {
    subject: v.subject, verb: v.verb, object: v.object, partition: v.partition ?? [], not: v.not === true,
    cites: v.cite ?? [], why: v.why, by: isAgentRun(env) ? "agent" : "person",
  });
  if (!r.ok) return done(`claim refused:\n${r.reasons.map((x) => `  - ${x}`).join("\n")}`, 1);
  return done(`claim ${r.claim.id} PROPOSED · inferred: ${claimLabel(r.claim, facts.labels)} — ${r.claim.cites.length} cited line(s) hashed${r.note ? `\n  ${r.note}` : ""}\n  a person decides: \`vibegraph-knowledge claim agree|reject ${r.claim.id}\`, or the inbox`);
}
