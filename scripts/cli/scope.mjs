// `scope` — "Scope this node" from the command line (2026-10-06). The one
// token-spending step of In → Process → Out: a model is shown one box's
// dossier (its call sites, edges and any ratified software spec, numbered)
// and may describe it only in the operation vocabulary, citing what it was
// shown (src/server/node_scope.ts). The result is PROPOSED in
// .vibegraph/architecture.json; ratify / reject are a person's steps.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { cliPath } from "./winpath.mjs";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildCrossingIndex } from "../../src/server/crossings.ts";
import { archModelForEnvelope } from "../../src/server/arch_envelope.ts";
import { applyArchStore, loadArchStore, saveArchStore } from "../../src/server/arch_store.ts";
import { listSpecs } from "../../src/server/software_store.ts";
import { loadVocabulary } from "../../src/server/operation_vocab.ts";
import { buildScopePrompt, decideScope, parseScope, scopeDossier } from "../../src/server/node_scope.ts";
import { linesReader } from "../../src/server/node_scope_server.ts";
import { nodeIO, ioLines } from "../../src/shared/node_io.ts";
import { spawnClassifier } from "./classify.mjs";

export const SCOPE_USAGE = `scope <box id> [--note "<what to look at>"] [--reply <file>] [--dry-run] | scope list | scope ratify|reject <box id>   [--root <dir>]
                                  describe a box the code says little about: a model sees its call sites, edges and
                                  software spec and may use only the operation vocabulary, citing each claim (SPENDS
                                  TOKENS; --dry-run prints the prompt). The scope waits PROPOSED; ratify / reject are
                                  a person's steps. Only a ratified scope reaches In → Process → Out and architecture.md`;

function mapOf(root) {
  const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
  const derived = archModelForEnvelope(envelope, buildStackIndex(envelope, root), buildCrossingIndex(envelope), root, undefined, { applyStore: false });
  return applyArchStore(derived, loadArchStore(root));
}

export function runScope(args, env = process.env) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { root: { type: "string" }, note: { type: "string" }, reply: { type: "string" }, "dry-run": { type: "boolean" }, model: { type: "string" } } });
  } catch (e) { return { exitCode: 2, text: `${e.message}\n\nusage: vibegraph-knowledge ${SCOPE_USAGE}\n` }; }
  const root = resolve(cliPath(parsed.values.root ?? "."));
  const [a, b] = parsed.positionals;
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  const store = loadArchStore(root);

  if (a === "list") {
    const rows = Object.values(store.scopes ?? {});
    if (!rows.length) return done("no box is scoped yet — vibegraph-knowledge scope <box id>");
    return done(rows.map((r) => `${r.node}: ${r.ratified ? `ratified (${r.ratified.model})` : ""}${r.ratified && r.proposed ? "; " : ""}${r.proposed ? `PROPOSED by ${r.proposed.model}` : ""}`).join("\n"));
  }
  if (a === "ratify" || a === "reject") {
    if (!b) return done(`usage: vibegraph-knowledge scope ${a} <box id>`, 2);
    const r = decideScope(store.scopes ?? {}, b, a);
    if (r.error) return done(r.error, 1);
    store.scopes = r.scopes;
    if (!Object.keys(store.scopes).length) delete store.scopes;
    saveArchStore(root, store);
    return done(a === "ratify" ? `ratified: the scope of ${b} now reaches In → Process → Out (by whoever ran this command)` : `rejected: the proposed scope of ${b} is dropped`);
  }
  if (!a) return done(`usage: vibegraph-knowledge ${SCOPE_USAGE}`, 2);

  const model = mapOf(root);
  if (!model.nodes.some((n) => n.id === a)) {
    const near = model.nodes.filter((n) => n.id.includes(a) || n.label.toLowerCase().includes(a.toLowerCase())).slice(0, 6);
    return done(`no box ${a} on the map${near.length ? ` — did you mean: ${near.map((n) => `${n.id} (${n.label})`).join(", ")}` : ""}`, 1);
  }
  const vocab = loadVocabulary(root).vocab;
  let specs = [];
  try { specs = listSpecs(root); } catch { specs = []; }
  const dossier = scopeDossier(model, a, { readLines: linesReader(root), specs, vocab });
  const prompt = buildScopePrompt(model, a, dossier, vocab, parsed.values.note);
  if (parsed.values["dry-run"]) return done(prompt);
  let text, label = "saved reply";
  if (parsed.values.reply) text = readFileSync(resolve(parsed.values.reply), "utf-8");
  else {
    const r = spawnClassifier({ prompt, model: parsed.values.model, cwd: root, env });
    if (!r.ok) return done(r.error, 3);
    text = r.text; label = r.model;
  }
  const p = parseScope(text, model, a, dossier, { model: label, vocab });
  if (!p.scope) return done(p.error ?? "the reply was not a usable scope", 3);
  const cur = store.scopes?.[a];
  store.scopes = { ...(store.scopes ?? {}), [a]: { node: a, ...(cur?.ratified ? { ratified: cur.ratified } : {}), proposed: p.scope } };
  saveArchStore(root, store);
  const s = p.scope;
  const cite = (ev) => (ev.length ? ev.join(", ") : "INFERRED — no citation");
  const lines = [`scope of ${a} from ${s.model}, PROPOSED in .vibegraph/architecture.json:`, ...(s.summary ? [`  ${s.summary}`] : [])];
  for (const w of s.words) lines.push(`  ${w.word} — ${cite(w.evidence)}`);
  for (const r of s.in) lines.push(`  in from ${r.node}: ${r.what} — ${cite(r.evidence)}`);
  for (const r of s.out) lines.push(`  out to ${r.node}: ${r.what} — ${cite(r.evidence)}`);
  for (const r of s.refused) lines.push(`  refused ${r.item}: ${r.reason}`);
  const io = ioLines(nodeIO(model, a, vocab, { [a]: { node: a, ratified: s } }));
  lines.push(`if ratified: in: ${io.in} · ${io.process} · out: ${io.out}`, `decide it: vibegraph-knowledge scope ratify ${a}  |  scope reject ${a}`);
  return done(lines.join("\n"));
}
