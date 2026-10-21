#!/usr/bin/env node
// Score a set of written rules against a gold set (2026-10-19, PLAN-M-RULES
// M3). The DETERMINISTIC half of the rubric; the reader's half comes from a
// judgments file a person (or a model, labelled as one) writes:
//
//   cited      the rule's `cite` sentence is in its file near its line, or its
//              note names the facts it rests on (a proposal from the architecture)
//   scope      the threads it routes to, compared with the gold rule it was judged
//              to match: Jaccard of the two routed sets (the server's routing)
//   check      its check's verdict on the clean tree and on a BYPASS tree with
//              planted breaks: it "catches" when clean is not violated and the
//              bypass is
//   real, why  from the judgments: a decision the code cannot reveal? does it say why?
//
//   node --experimental-strip-types scripts/dev/score_rules.mjs <tree> <run dir>... [--judged <file>] [--json]
//     tree: fleet | fleet-blind | ops
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { buildPolyglotEnvelope } from "../regen_polyglot.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { routeConstraints, statedRules } from "../../src/server/constraint_store.ts";
import { checkStatedRules } from "../../src/server/constraint_report.ts";
import { citedAt } from "../cli/constraints.mjs";

const TREES = {
  fleet: { root: "examples/fleet-telemetry", gold: () => JSON.parse(readFileSync("examples/fleet-telemetry/.vibegraph/constraints.json", "utf-8")).constraints },
  ops: { root: "test/fixtures/harvest/ops_demo", gold: () => JSON.parse(readFileSync("reviews/m-rules/gold/ops.json", "utf-8")).rules },
};
TREES["fleet-blind"] = TREES.fleet;

/** One planted break of each rule class a written check could be about. */
const PLANTS = {
  fleet: (d) => {
    appendFileSync(join(d, "telemetry/alerts.py"), '\n\nimport requests\n\n\ndef page_region_change(device_id: str, region: str) -> None:\n    requests.post("https://hooks.example/region", json={"device_id": device_id, "region": region})\n    notify({"device_id": device_id, "metric": "region", "value": region})\n');
    appendFileSync(join(d, "telemetry/devices.py"), '\n\nimport sqlite3\n\n\ndef raw_count() -> int:\n    return sqlite3.connect("telemetry.db").execute("select count(*) from readings").fetchone()[0]\n');
    appendFileSync(join(d, "gateway/server.ts"), '\nexport async function pingUpstream(): Promise<number> {\n  const res = await fetch("http://localhost:5000/health");\n  return res.status;\n}\n');
    appendFileSync(join(d, "ops/backup.sh"), "\nssh backup-host 'df -h'\n");
    // the guard classes a proposed check can be about: ingest without the token check, a forward
    // without the caller's token, rows stored without validation or normalisation
    appendFileSync(join(d, "telemetry/app.py"), "\n\ndef ingest_unchecked(body: dict) -> dict:\n    return ingest_batch(body)\n");
    appendFileSync(join(d, "gateway/server.ts"), '\nexport async function forwardRaw(req, res) {\n  res.json(await postIngest(req.body, "service-token"));\n}\n');
    appendFileSync(join(d, "telemetry/devices.py"), "\n\nfrom telemetry.storage import insert_readings\n\n\ndef store_raw(rows: list) -> None:\n    insert_readings(rows)\n");
  },
  ops: (d) => {
    const c = join(d, "model/client.ts");
    writeFileSync(c, readFileSync(c, "utf-8").replace('{ model: "reasoning-5", messages }', '{ model: "reasoning-5", messages, temperature: 0.1 }'));
    const p = join(d, "db/provision.ts");
    writeFileSync(p, readFileSync(p, "utf-8").replace('await conn.query("REVOKE ALL ON DATABASE credits FROM PUBLIC");', 'await conn.query("REVOKE ALL ON DATABASE credits FROM PUBLIC");\n  await conn.query("GRANT SELECT ON DATABASE credits TO analyst");'));
    // a second door to each SDK
    appendFileSync(join(d, "jobs/registry.ts"), '\nimport OpenAI from "openai";\nexport const stray = new OpenAI();\n');
    appendFileSync(join(d, "model/client.ts"), '\nimport { Client } from "pg";\nexport const strayDb = new Client();\n');
  },
};
PLANTS["fleet-blind"] = PLANTS.fleet;

function load(root) {
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  return { env, stack: buildStackIndex(env, root) };
}
const routed = (rule, { env, stack }) => new Set(env.threads.filter((t) => t.entryPointId && routeConstraints([rule], { entryPointId: t.entryPointId, filesReached: t.filesReached, stack: stack.byThread[t.entryPointId] }).length).map((t) => t.entryPointId));
const jaccard = (a, b) => { const u = new Set([...a, ...b]); if (!u.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / u.size; };
const worst = (results) => (results.find((r) => r.verdict === "violated") ?? results.find((r) => r.verdict === "unverifiable") ?? results[0])?.verdict ?? null;
const verdictOf = (rule, root, l) => (rule.check || rule.checks?.length ? worst(checkStatedRules({ envelope: l.env, root, stack: l.stack, constraints: [rule] }).results) : null);

export function scoreRuns(treeName, runDirs, judged = {}) {
  const tree = TREES[treeName];
  const root = resolve(tree.root);
  const clean = load(root);
  const tmp = mkdtempSync(join(tmpdir(), "vg-score-"));
  const bypassRoot = join(tmp, "bypass");
  cpSync(root, bypassRoot, { recursive: true, filter: (p) => !p.includes("__pycache__") && !p.includes("/.vibegraph/knowledge") });
  PLANTS[treeName](bypassRoot);
  const bypass = load(bypassRoot);
  const gold = tree.gold();
  const goldRouted = new Map(gold.map((g) => [g.id, routed(g, clean)]));
  const goldChecks = gold.filter((g) => g.check || g.checks?.length).map((g) => ({ id: g.id, clean: verdictOf(g, root, clean), bypass: verdictOf(g, bypassRoot, bypass) }));
  const runs = runDirs.map((dir) => {
    const name = basename(dir);
    const file = ["constraints.json"].map((f) => join(dir, f)).find(existsSync);
    const rules = file ? statedRules(JSON.parse(readFileSync(file, "utf-8")).constraints).filter((c) => c.source !== "human") : [];
    const j = judged[name] ?? {};
    const rows = rules.map((r) => {
      const cited = r.cite ? (citedAt(root, r.cite).ok ? "sentence" : "BROKEN") : /rests on /.test(r.note ?? "") ? "facts" : "none";
      const set = routed(r, clean);
      const verdict = { clean: verdictOf(r, root, clean), bypass: verdictOf(r, bypassRoot, bypass) };
      const judgement = j[r.id] ?? {};
      return {
        id: r.id, text: r.text.slice(0, 110), cited, reaches: set.size, gold: judgement.gold ?? null,
        scope: judgement.gold && goldRouted.has(judgement.gold) ? Math.round(jaccard(set, goldRouted.get(judgement.gold)) * 100) / 100 : null,
        check: verdict.clean ? `${verdict.clean} → ${verdict.bypass}` : null,
        catches: !!verdict.clean && verdict.clean !== "violated" && verdict.bypass === "violated",
        real: judgement.real ?? null, why: judgement.why ?? null, reason: judgement.reason ?? null,
      };
    });
    const judgedRows = rows.filter((r) => r.real !== null);
    const matched = new Set(rows.filter((r) => r.real && r.gold).map((r) => r.gold));
    const scopes = rows.filter((r) => r.real && r.scope !== null).map((r) => r.scope);
    return {
      run: name, rules: rows.length,
      precision: judgedRows.length ? `${judgedRows.filter((r) => r.real).length}/${judgedRows.length}` : "unjudged",
      recall: `${matched.size}/${gold.length}`, recalled: [...matched].sort(),
      scope: scopes.length ? Math.round((scopes.reduce((a, b) => a + b, 0) / scopes.length) * 100) / 100 : null,
      cited: `${rows.filter((r) => r.cited === "sentence" || r.cited === "facts").length}/${rows.length}`,
      checks: `${rows.filter((r) => r.check).length} with a check, ${rows.filter((r) => r.check && !r.check.startsWith("unverifiable")).length} decidable, ${rows.filter((r) => r.catches).length} catch a planted break`,
      why: judgedRows.length ? `${judgedRows.filter((r) => r.why).length}/${judgedRows.length}` : "unjudged",
      rows,
    };
  });
  rmSync(tmp, { recursive: true, force: true });
  return { tree: treeName, gold: gold.map((g) => g.id), goldChecks, runs };
}

export function formatScores(s) {
  const L = [`## ${s.tree} — gold: ${s.gold.join(", ")}`, "", `gold checks on clean → bypass: ${s.goldChecks.map((g) => `${g.id} ${g.clean} → ${g.bypass}`).join("; ") || "none"}`, "",
    "| run | rules | real (precision) | gold found (recall) | scope vs gold | cited | checks | says why |", "|---|---|---|---|---|---|---|---|"];
  for (const r of s.runs) L.push(`| ${r.run} | ${r.rules} | ${r.precision} | ${r.recall}${r.recalled.length ? ` (${r.recalled.join(", ")})` : ""} | ${r.scope ?? "—"} | ${r.cited} | ${r.checks} | ${r.why} |`);
  for (const r of s.runs) {
    L.push("", `### ${r.run}`, "", "| id | rule | real | gold | scope | cited | check (clean → bypass) | reading |", "|---|---|---|---|---|---|---|---|");
    for (const x of r.rows) L.push(`| ${x.id} | ${x.text.replace(/\|/g, "/")} | ${x.real === null ? "?" : x.real ? "yes" : "no"} | ${x.gold ?? "—"} | ${x.scope ?? "—"} | ${x.cited} | ${x.check ?? "—"}${x.catches ? " (catches)" : ""} | ${(x.reason ?? "").replace(/\|/g, "/")} |`);
  }
  return L.join("\n") + "\n";
}

if (process.argv[1] && basename(process.argv[1]) === "score_rules.mjs") {
  const args = process.argv.slice(2);
  const ji = args.indexOf("--judged");
  const judged = ji >= 0 ? JSON.parse(readFileSync(args[ji + 1], "utf-8")) : {};
  const json = args.includes("--json");
  const pos = args.filter((a, i) => !a.startsWith("--") && (ji < 0 || i !== ji + 1));
  const s = scoreRuns(pos[0], pos.slice(1).map((d) => resolve(d)), judged);
  process.stdout.write(json ? JSON.stringify(s, null, 2) + "\n" : formatScores(s));
}
