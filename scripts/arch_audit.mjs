// Audit the architecture map on every project (2026-09-25): model integrity,
// every lens, the agent page, the HTML and the laid-out map — through the
// same functions the GUI, architecture.html and the export use. Written to
// check a map change on the other examples before it can degrade a private production codebase.
//
//   npm run audit:arch                       every example + fixture project (+ a private production codebase when present)
//   node --experimental-strip-types --no-warnings scripts/arch_audit.mjs [--json out.json] [root...]
//
// Flags, per project: dangling / self / duplicate edges, a process with no
// entry points, non-test entry points in no process, two boxes sharing a
// label, a tool nobody calls, a schema failure of the system map, "undefined"
// or "NaN" in architecture.md, a lens that draws nothing, an edge routed
// through an unrelated card, an edge to an undrawn box, an unrouted edge,
// two labels on one spot. Reports per lens: labels drawn / hidden / shortened
// / AMBIGUOUS (covering another edge's line). Exit 1 when anything is flagged.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { buildPolyglotEnvelope } from "./regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { buildSystemMap } from "../src/server/system_map.ts";
import { renderSystemMapMd } from "../src/server/system_map_md.ts";
import { renderArchHtml } from "../src/server/arch_html.ts";
import { buildArchLayout, cardHeight, labelBox, CARD_W } from "../src/webview/system/archLayout.ts";
import { ARCH_LENSES } from "../src/webview/system/arch_lens.ts";
import { deriveThreadCalls } from "../src/webview/system/threadInteraction.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const F = "test/fixtures";
const DEFAULT_ROOTS = [
  "examples/private-codebase", "examples/fleet-telemetry", "examples/pump-wear", "examples/pump-polyglot",
  `${F}/polyglot/shop_demo`, `${F}/webstack/next_demo`, `${F}/system/system_demo`, `${F}/system/library_only`,
  `${F}/arch/cloud_demo`, `${F}/arch/dispatch_demo`, `${F}/architecture/composed_demo`, `${F}/architecture/model_zoo`,
  `${F}/rust/router_demo`, `${F}/cpp/geometry_demo`, `${F}/cpp/router_demo`, `${F}/jsts/api_demo`, `${F}/bash/deploy_demo`,
  `${F}/stack/stdlib_demo`, `${F}/threads/flask_demo`, `${F}/threads/big_demo`, `${F}/threads/deps_demo`,
  `${F}/threads/flask_factory_demo`, `${F}/comprehension/comp_demo`,
].map((r) => join(ROOT, r)).filter((r) => existsSync(r));

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
if (!args.length) args.push(...DEFAULT_ROOTS);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas/system_map.schema.json"), "utf-8")));

/** Labels per lens: drawn, hidden (no free spot), shortened, and ambiguous
 *  (its box covers another edge's line, so a reader cannot tell which line it names). */
function labelStats(l) {
  const segs = l.edges.flatMap((e) => (e.data?.points ?? []).slice(0, -1).map((p, i) => ({ id: e.id, a: p, b: e.data.points[i + 1] })));
  let drawn = 0, hidden = 0, cut = 0, ambiguous = 0;
  for (const e of l.edges) {
    if (!e.data?.fullLabel) continue;
    if (!e.label) { hidden++; continue; }
    drawn++;
    if (e.label !== e.data.fullLabel) cut++;
    const b = labelBox(e.label);
    const { cx, cy } = e.data.labelAt;
    const r = { x0: cx - b.w / 2 + 1, x1: cx + b.w / 2 - 1, y0: cy - b.h / 2 + 1, y1: cy + b.h / 2 - 1 };
    if (segs.some((s) => s.id !== e.id
      && Math.max(Math.min(s.a[0], s.b[0]), r.x0) <= Math.min(Math.max(s.a[0], s.b[0]), r.x1)
      && Math.max(Math.min(s.a[1], s.b[1]), r.y0) <= Math.min(Math.max(s.a[1], s.b[1]), r.y1))) ambiguous++;
  }
  return `${drawn}d ${hidden}h ${cut}c ${ambiguous}amb`;
}

function throughCards(l) {
  // A routed segment that passes through the interior of a card that is
  // neither of its edge's endpoints.
  const cards = l.nodes.filter((n) => n.type === "archNode").map((n) => ({
    id: n.id, x0: n.position.x, y0: n.position.y, x1: n.position.x + CARD_W, y1: n.position.y + cardHeight(n.data.node),
  }));
  const hits = [];
  for (const e of l.edges) {
    const p = e.data?.points ?? [];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      for (const c of cards) {
        if (c.id === e.source || c.id === e.target) continue;
        const ix0 = Math.max(Math.min(ax, bx), c.x0 + 1), ix1 = Math.min(Math.max(ax, bx), c.x1 - 1);
        const iy0 = Math.max(Math.min(ay, by), c.y0 + 1), iy1 = Math.min(Math.max(ay, by), c.y1 - 1);
        if (ix0 <= ix1 && iy0 <= iy1) hits.push(`${e.id} through ${c.id}`);
      }
    }
  }
  return hits;
}

const report = {};
for (const root of args) {
  const r = { issues: [], stats: {} };
  report[root] = r;
  try {
    const env = buildPolyglotEnvelope(root).envelope;
    const crossings = buildCrossingIndex(env);
    const model = archModelForEnvelope(env, buildStackIndex(env, root), crossings, root);
    const ids = new Set(model.nodes.map((n) => n.id));
    const gids = new Set(model.groups.map((g) => g.id));
    const clusters = model.nodes.filter((n) => n.kind === "cluster");
    r.stats = {
      files: Object.keys(env.files).length, entryPoints: env.entryPoints.length,
      clusters: clusters.length, hubs: model.nodes.filter((n) => n.kind === "hub").length,
      tools: model.nodes.filter((n) => n.kind === "tool").length,
      edges: model.edges.length, hops: model.edges.filter((e) => e.kind !== "uses").length, groups: model.groups.length,
    };
    // model integrity
    for (const e of model.edges) if (!ids.has(e.from) || !ids.has(e.to)) r.issues.push(`dangling edge ${e.id}`);
    for (const e of model.edges) if (e.from === e.to) r.issues.push(`self edge ${e.id}`);
    const eids = model.edges.map((e) => e.id);
    if (new Set(eids).size !== eids.length) r.issues.push(`duplicate edge ids: ${eids.filter((x, i) => eids.indexOf(x) !== i).slice(0, 3).join(", ")}`);
    const nids = model.nodes.map((n) => n.id);
    if (new Set(nids).size !== nids.length) r.issues.push("duplicate node ids");
    for (const c of clusters) if (!(c.entryPoints ?? []).length) r.issues.push(`cluster with no entry points: ${c.id}`);
    for (const h of model.nodes.filter((n) => n.kind === "hub")) if (h.cluster && !ids.has(h.cluster)) r.issues.push(`hub ${h.id} names a missing cluster ${h.cluster}`);
    for (const g of model.groups) for (const w of g.wraps) if (!ids.has(w) && !gids.has(w)) r.issues.push(`group ${g.id} wraps missing ${w}`);
    const epInClusters = new Set(clusters.flatMap((c) => c.entryPoints ?? []));
    const nonTest = env.entryPoints.filter((e) => e.kind !== "test");
    const unplacedEps = nonTest.filter((e) => !epInClusters.has(e.id));
    if (unplacedEps.length) r.issues.push(`${unplacedEps.length}/${nonTest.length} non-test entry points in no process: ${unplacedEps.slice(0, 4).map((e) => e.id).join(", ")}`);
    const labels = new Map();
    for (const n of model.nodes) labels.set(n.label, [...(labels.get(n.label) ?? []), n.id]);
    for (const [l, list] of labels) if (list.length > 1) r.issues.push(`two boxes share the label "${l}": ${list.join(", ")}`);
    for (const e of model.edges) if (!e.protocol || e.protocol === "undefined") r.issues.push(`edge without protocol ${e.id}`);
    for (const t of model.nodes.filter((n) => n.kind === "tool")) if (!model.edges.some((e) => e.to === t.id)) r.issues.push(`tool nobody calls ${t.id}`);
    // the system map
    const map = buildSystemMap(model, { title: basename(root), entryPoints: env.entryPoints, system: env.system ?? null, threadGraph: deriveThreadCalls(env.threads, env.entryPoints, crossings) });
    if (!validate(map)) r.issues.push(`schema: ${JSON.stringify(validate.errors.slice(0, 2))}`);
    const md = renderSystemMapMd(map);
    for (const bad of ["undefined", "NaN", "[object Object]", "null →", "→ null"]) if (md.includes(bad)) r.issues.push(`architecture.md contains "${bad}": ${md.split("\n").find((l) => l.includes(bad)).slice(0, 140)}`);
    r.stats.mdBytes = md.length;
    const html = renderArchHtml(model, { title: basename(root) });
    if (!html.includes("vg-data")) r.issues.push("html missing data");
    // lenses
    const lensStats = {};
    for (const lens of ARCH_LENSES) {
      const v = map.views[lens];
      const l = buildArchLayout(model, lens);
      if (lens !== "trust" && !v.nodes.length && clusters.length) r.issues.push(`${lens}: draws nothing`);
      const hit = throughCards(l);
      if (hit.length) r.issues.push(`${lens}: ${hit.length} edge segments through unrelated cards (${hit.slice(0, 2).join("; ")})`);
      const drawnIds = new Set(l.nodes.map((n) => n.id));
      for (const e of l.edges) if (!drawnIds.has(e.source) || !drawnIds.has(e.target)) r.issues.push(`${lens}: edge ${e.id} to an undrawn box`);
      const noRoute = l.edges.filter((e) => !(e.data?.points?.length >= 2));
      if (noRoute.length) r.issues.push(`${lens}: ${noRoute.length} edges with no route`);
      // label collisions: two drawn edge labels at the same spot
      const at = l.edges.map((e) => e.data?.labelAt).filter(Boolean).map((p) => `${Math.round(p.cx)},${Math.round(p.cy)}`);
      if (new Set(at).size !== at.length) r.issues.push(`${lens}: ${at.length - new Set(at).size} edge labels stacked on one spot`);
      lensStats[lens] = `${v.nodes.length}n/${v.edges.length}e · labels ${labelStats(l)}`;
    }
    r.stats.lenses = lensStats;
  } catch (e) {
    r.issues.push(`THREW: ${e.stack?.split("\n").slice(0, 3).join(" | ")}`);
  }
  console.log(`\n== ${root}  ${JSON.stringify(r.stats)}`);
  for (const i of r.issues) console.log(`   - ${i}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
const flagged = Object.values(report).reduce((k, r) => k + r.issues.length, 0);
console.log(`
${Object.keys(report).length} projects, ${flagged} issue(s) flagged`);
process.exitCode = flagged ? 1 : 0;
