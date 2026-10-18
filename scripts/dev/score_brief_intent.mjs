#!/usr/bin/env node
// Score a proposed Brief against the intent of test/fixtures/brief/exchange_demo
// (the brief-intent drill, 2026-10-14, reviews/brief-intent/). The project's
// point: partners see ONLY decisions that verify, and what a partner forges is
// quarantined and our copy restored. A field Brief never said its decisions were
// verified, left quarantine out as "secondary", and said the exchange
// "replicates status to the partner … which the platform syncs".
//
//   node scripts/dev/score_brief_intent.mjs <root>/.vibegraph/brief.json [--json]
//
// Per draft, each a claim some line must make (a person still reads the lines;
// this flags):
//   verify      decisions or documents are verified / signature-checked
//   publish     what reaches the partner's zone is limited to what verifies
//   quarantine  what does not verify is quarantined
//   restore     our copy is restored over the partner's
//   inverted    our decisions are said to replicate / sync / mirror to the
//               partner with no word of verification (the field error)
//   secondary   `omitted` calls quarantine or verification secondary / left out
import { readFileSync } from "node:fs";

const file = process.argv[2];
const json = process.argv.includes("--json");
const rec = JSON.parse(readFileSync(file, "utf-8"));
const p = rec.proposed ?? rec.ratified ?? {};
const lines = ["function", "method", "feature"].flatMap((k) => (p.spec?.[k] ?? []).map((l) => ({ part: k, text: l.text })));
const any = (test) => lines.some((l) => test(l.text));
const VERIFY = /verif|signature (check|fail)|signature does not/i;
const claims = {
  verify: any((t) => VERIFY.test(t)),
  // the publish GUARD (only what verifies goes out) — not the restore, which runs when verification FAILS
  publish: any((t) => /(publish|shar|partner_status|partner's (shared )?zone)/i.test(t)
    && /(only[^.]*verif|verified decisions|verif\w*[^.]*before (shar|publish)|when verify\([^)]*\) holds|whose signature verifies)/i.test(t)),
  quarantine: any((t) => /quarantin/i.test(t)),
  restore: any((t) => /restor|back from our|from ours|our (signed )?copy/i.test(t)),
};
const inverted = lines.filter((l) => /\b(replicat|sync|mirror|propagat)\w*/i.test(l.text) && /partner/i.test(l.text) && /(status|decision)/i.test(l.text) && !/verif/i.test(l.text));
const secondary = (p.omitted ?? []).filter((o) => /(quarantin|verified|verifies|verification)/i.test(o));
const missing = Object.entries(claims).filter(([, v]) => !v).map(([k]) => k);
const score = { lines: lines.length, ...claims, inverted: inverted.length, secondary: secondary.length, errors: missing.length + inverted.length + secondary.length };
if (json) { console.log(JSON.stringify({ score, missing, lines, omitted: p.omitted ?? [], inverted: inverted.map((l) => l.text) }, null, 2)); process.exit(0); }
const yn = (b) => (b ? "yes" : "NO");
console.log(`lines ${score.lines} · verify ${yn(claims.verify)} · publish-only-verified ${yn(claims.publish)} · quarantine ${yn(claims.quarantine)} · restore ${yn(claims.restore)} · inverted ${score.inverted} · omitted-as-secondary ${score.secondary} · errors ${score.errors}`);
for (const l of lines) console.log(`  [${l.part}] ${l.text}`);
for (const o of p.omitted ?? []) console.log(`  (omitted) ${o}`);
