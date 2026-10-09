// The run-time ladder in a hooked session (2026-10-08). Zero tokens; no hook
// ever calls a model or decides anything.
//
//   a prompt     when it routes to a thread of a box that has an open FACTS GAP
//                (the plan says the box watches / reads / writes a zone, the code
//                shows no such call, no ratified claim answers it): one line
//                naming the gap and the command to propose what the session
//                finds — at most three a prompt, each gap once a session
//
// (The Brief's lines carry their evidence kinds at session start:
// brief_context.mjs.)
//
// The gaps need the derived map (seconds on a large project), so they are
// cached beside the envelope, keyed on the threads and the files they read.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDirFor } from "../envelope_cache.mjs";
import { archModelForEnvelope } from "../../src/server/arch_envelope.ts";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildCrossingIndex } from "../../src/server/crossings.ts";
import { briefData, openGaps } from "../../src/server/brief_data.ts";
import { loadPlan } from "../../src/server/plan_store.ts";
import { declaredTopology } from "../../src/server/arch_label_drift.ts";
import { liveClaims } from "../../src/server/claim_store.ts";
import { linesReader } from "../../src/server/node_scope.ts";
import { declaredFeeds } from "../../src/server/topology_feeds.ts";

const PER_PROMPT = 3;
const VERB = { watch: "watches", read: "reads", write: "writes" };
const mtime = (p) => { try { return String(statSync(p).mtimeMs); } catch { return "-"; } };

/** Every open gap: {key, box, label, threads, op, zone, cite}. Cached. */
export function openGapList(absRoot, env) {
  const v = join(absRoot, ".vibegraph");
  // a claim stops counting when a line it cites changes: its files are part of the key
  let cited = [];
  try { cited = [...new Set(JSON.parse(readFileSync(join(v, "claims.json"), "utf-8")).claims.flatMap((k) => k.cites.map((c) => c.replace(/:\d+$/, ""))))].sort(); } catch { cited = []; }
  const key = createHash("sha1").update(JSON.stringify([env.threads.map((t) => [t.entryPointId, t.filesReached ?? []]), mtime(join(v, "plan.json")), mtime(join(v, "claims.json")), mtime(join(v, "topology")), cited.map((f) => [f, mtime(join(absRoot, f))])])).digest("hex");
  const file = join(cacheDirFor(absRoot), "open-gaps.json");
  try { const c = JSON.parse(readFileSync(file, "utf-8")); if (c.key === key) return c.gaps; } catch { /* build */ }
  let gaps = [];
  try {
    const model = archModelForEnvelope(env, buildStackIndex(env, absRoot), buildCrossingIndex(env), absRoot, undefined, { applyStore: false });
    const plan = loadPlan(absRoot), topology = declaredTopology(absRoot).topology;
    const data = briefData(model, { plan, topology, claims: liveClaims(absRoot, linesReader(absRoot)), feeds: declaredFeeds(topology, model, plan, env.files) });
    const nodes = new Map(model.nodes.map((n) => [n.id, n]));
    gaps = openGaps(data).map((o) => ({ key: `${o.box}|${o.op}|${o.zone}`, box: o.box, label: nodes.get(o.box)?.label ?? o.box, threads: nodes.get(o.box)?.threads ?? [], op: o.op, zone: o.zone, cite: o.cite, located: !!o.located }));
  } catch { gaps = []; }
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ key, gaps })); } catch { /* only slower */ }
  return gaps;
}

/** One line per open gap on a box the prompt routes to, not yet sent this session. */
export function gapLinesForPrompt(absRoot, env, routedEps, state) {
  if (!routedEps?.length) return [];
  const routed = new Set(routedEps);
  const sent = new Set(state.gapsSent ?? []);
  const out = [];
  for (const g of openGapList(absRoot, env)) {
    if (out.length >= PER_PROMPT || sent.has(g.key) || !g.threads.some((t) => routed.has(t))) continue;
    const zone = g.zone.replace(/^zone:/, "");
    out.push(`- open facts gap: ${g.label} ${VERB[g.op] ?? g.op} ${zone} (${g.cite}; the code shows no such call). If you confirm how while you work, propose it: \`vibegraph-knowledge claim propose --subject ${g.box} --verb ${VERB[g.op] ?? g.op} --object ${zone} --cite <file:line>…\` — a person decides.`);
    sent.add(g.key);
  }
  state.gapsSent = [...sent];
  return out.length ? ["What the map cannot see here (it is decided at run time):", ...out] : [];
}

