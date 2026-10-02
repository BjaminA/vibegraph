#!/usr/bin/env node
// Score an export against a reference architecture (dev tool, not product code).
//
// A reference (`vibegraph-reference/v1`) is what an ideal analysis of one
// codebase would find, written by its own team from their own declarations. It
// is an ORACLE: VibeGraph never reads it. This scores what an export derived
// against it, section by section, strictly: a name appearing somewhere in the
// prose does not count; the structured fact has to be there.
//
//   node scripts/dev/score_reference.mjs <reference.json> <export-dir> [--json]
//
// The export must be written with --with-ir (envelope.json, ir/, stack.json)
// so the facts are readable; data_topology.json is what the topology work adds.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [refPath, outDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const asJson = process.argv.includes("--json");
if (!refPath || !outDir) { console.error("usage: score_reference.mjs <reference.json> <export-dir> [--json]"); process.exit(2); }

const ref = JSON.parse(readFileSync(refPath, "utf8"));
const read = (p, dflt = null) => (existsSync(join(outDir, p)) ? JSON.parse(readFileSync(join(outDir, p), "utf8")) : dflt);
const env = read("envelope.json", { entryPoints: [], threads: [] });
const stack = read("stack.json", { tools: [] });
const data = read("data_topology.json", {});
const topo = data.topology ?? {};
const irCache = new Map();
const irOf = (file) => {
  if (!irCache.has(file)) irCache.set(file, read(`ir/${file}.ir.json`));
  return irCache.get(file);
};

const at = (s) => { const m = /^(.*):(\d+)$/.exec(s ?? ""); return m ? { file: m[1], line: Number(m[2]) } : { file: s, line: null }; };
const norm = (s) => String(s ?? "").replace(/\s*\(.*\)\s*$/, "").replace(/^role:/, "").trim();
const holes = (s) => String(s ?? "").replace(/\{[^}]*\}/g, "{}");
const patternRe = (p) => new RegExp("^" + String(p).replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{[^}]*\\?\}|\{[^}]*\}/g, "[^/]+") + "$");
const sameSet = (a, b) => { const x = [...new Set((a ?? []).map(norm))].sort(); const y = [...new Set((b ?? []).map(norm))].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };
const expand = (glob) => {
  const m = /^(.*)\{([^}]+)\}(.*)$/.exec(glob);
  return m ? m[2].split(",").flatMap((alt) => expand(`${m[1]}${alt}${m[3]}`)) : [glob];
};
const under = (file, glob) => expand(glob).some((g) => (g.endsWith("/") ? file.startsWith(g) : g.includes("*") ? new RegExp("^" + g.replace(/\./g, "\\.").replace(/\*/g, "[^/]*") + "$").test(file) : file === g));

const sections = [];
const section = (name, items, test, note) => {
  const rows = items.map((it) => ({ it, ...test(it) }));
  sections.push({ name, total: rows.length, found: rows.filter((r) => r.found).length, full: rows.filter((r) => r.full ?? r.found).length, note, misses: rows.filter((r) => !r.found).map((r) => r.label ?? JSON.stringify(r.it).slice(0, 80)) });
};

// --- derived ---------------------------------------------------------------
const filesOfThread = (entryFile) => {
  const ths = (env.threads ?? []).filter((t) => (t.seed?.file ?? t.entryPointId ?? "").startsWith(entryFile) || (t.entryPointId ?? "").startsWith(`${entryFile}:`));
  return new Set(ths.flatMap((t) => (t.nodes ?? []).map((n) => n.file).filter(Boolean)));
};
section("modules", ref.derived.modules, (m) => ({ found: [...irCache.keys(), ...listIr()].some((f) => under(f, m.at)), label: m.id }), "lenient: files under the module are parsed");
function listIr() {
  const out = [];
  const walk = (d, rel) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), `${rel}${e.name}/`);
      else if (e.name.endsWith(".ir.json")) out.push(rel + e.name.slice(0, -".ir.json".length));
    }
  };
  walk(join(outDir, "ir"), "");
  return out;
}
section("runtime processes", ref.derived.runtimeProcesses, (p) => {
  const entries = expand(p.entry).flatMap((g) => (env.entryPoints ?? []).filter((e) => under(e.file, g)));
  if (!entries.length) return { found: false, label: p.id };
  const reached = new Set(entries.flatMap((e) => [...filesOfThread(e.file)]));
  const mods = Object.fromEntries(ref.derived.modules.map((m) => [m.id, m.at]));
  const uses = (p.uses ?? []).filter((u) => mods[u]);
  const usesOk = uses.every((u) => [...reached].some((f) => under(f, mods[u])));
  return { found: true, full: usesOk, label: `${p.id}${uses.length && !usesOk ? ` (uses: ${uses.filter((u) => ![...reached].some((f) => under(f, mods[u]))).join(", ")} not reached)` : ""}` };
}, "full = its thread reaches every module it uses");
section("stack", ref.derived.stack, (t) => ({ found: t.tool.split(/\s+\/\s+/).every((x) => (stack.tools ?? []).some((s) => s.name === x || s.tool === x)), label: t.tool }));

const sdkCalls = data.sdkCalls ?? [];
const effectOk = (want, got) => (want === "write/admin" ? ["write", "admin", "grant", "create", "delete"].includes(got) : want === "other" ? !!got : want === got);
section("platform calls", ref.derived.platformCalls.calls, (c) => {
  const { file, line } = at(c.at);
  const ir = irOf(file);
  const seen = !!ir?.nodes?.some((n) => n.line === line && (/call/.test(n.type) || n.callTarget) && String(n.funcName ?? n.callTarget ?? "").endsWith(c.method));
  const hit = sdkCalls.find((s) => s.file === file && s.line === line && String(s.callee).endsWith(c.method));
  return { found: !!hit, full: !!hit && effectOk(c.effect, hit.effect), label: `${c.method} ${c.at}${seen ? "" : " (no node)"}${hit ? ` → ${hit.effect}` : ""}` };
}, "found = attributed to a tool; full = the effect class matches");

const injections = data.injections ?? [];
section("injected capabilities", ref.derived.injectedCapabilities.calls, (call) => {
  const prop = call.split(".").pop();
  const hit = injections.filter((j) => j.property === prop && j.implementations?.some((i) => !i.test));
  return { found: hit.length > 0, label: call };
});

// --- declared topology ---------------------------------------------------------
const fams = topo.families ?? [];
const grantsTo = (zone, access) => (topo.grants ?? []).filter((g) => g.zone === zone && g.access === access).map((g) => g.who);
section("document families", ref.declaredTopology.documentFamilies.items, (f) => {
  const hit = fams.find((x) => holes(x.pattern) === holes(f.pathPattern));
  const writersOk = hit && sameSet(grantsTo(hit.zone ?? hit.id, "write"), f.writers);
  return { found: !!hit, full: !!writersOk, label: `${f.pathPattern}${hit && !writersOk ? ` (writers ${JSON.stringify(grantsTo(hit.zone ?? hit.id, "write"))})` : ""}` };
}, "full = its zone's write grants are the catalogue's writers");
const zones = topo.zones ?? [];
section("boundaries (zones)", ref.declaredTopology.boundaries.items, (b) => {
  const exact = zones.find((z) => z.id === b.boundary);
  const pat = exact ? null : zones.find((z) => /\{/.test(z.id) && patternRe(z.id).test(b.boundary));
  const z = exact ?? pat;
  const writersOk = z && sameSet(grantsTo(z.id, "write"), b.writers);
  return { found: !!z, full: !!exact && !!writersOk, label: `${b.boundary}${pat ? ` (pattern ${pat.id})` : ""}${z && !writersOk ? ` (writers ${JSON.stringify(grantsTo(z.id, "write"))} vs ${JSON.stringify(b.writers)})` : ""}` };
}, "found = a zone or a zone pattern; full = exact zone with the reference writers");
section("principals", ref.declaredTopology.principals.items, (p) => ({ found: (topo.principals ?? []).some((x) => x.id === p.id), label: p.id }), "stated layer: from a local, ignored file");

// --- decision structures -------------------------------------------------------
const trans = (topo.stateMachines ?? []).flatMap((m) => m.transitions ?? []);
section("transitions", ref.decisionStructures.stateMachine.rows, (r) => {
  const hit = trans.find((t) => t.from === r.from && t.to === r.to && sameSet(t.roles, r.roles));
  const reqOk = hit && sameSet((hit.requires ?? []).map((x) => x.replace(/^.*:/, "")), r.requires);
  return { found: !!hit, full: !!reqOk, label: `${r.from}→${r.to}` };
}, "found = from/to/roles; full = its guards (requires) too");
const tnodes = (topo.decisionTrees ?? []).flatMap((t) => t.nodes ?? []);
section("decision tree nodes", ref.decisionStructures.decisionTree.nodes, (n) => {
  const hit = tnodes.find((x) => x.id === n.node && x.yes === n.yes && x.no === n.no);
  const full = hit && hit.evaluatedBy === n.evaluatedBy && sameSet(hit.evidence ?? hit.reads, n.declaredEvidence);
  return { found: !!hit, full: !!full, label: n.node + (hit && !full ? ` (evaluatedBy ${hit.evaluatedBy})` : "") };
}, "found = yes/no; full = evaluating function + declared evidence");
section("evidence fold", ref.decisionStructures.evidenceFold.recordTypes, (t) => ({ found: tnodes.some((x) => (x.reads ?? []).some((r) => r.includes(t))), label: t }), "a decision node reads the family the record type lands in");

// --- flows ---------------------------------------------------------------------------
const hops = data.flows ?? [];
const procOf = (name) => { const p = ref.derived.runtimeProcesses.find((x) => x.id === norm(name)); return p ? expand(p.entry) : []; };
const steps = ref.flows.flatMap((f) => f.steps.map((s) => ({ ...s, flow: f.id })));
section("flow steps", steps, (s) => {
  const { file } = at(s.at);
  const famRe = (p) => holes(p);
  const fam = s.family.split(",")[0].replace(/\s*\(.*\)$/, "").trim();
  const sides = hops.flatMap((h) => [h.from, h.to].filter(Boolean).map((side) => ({ ...side, family: h.family })));
  const famOk = (x) => famRe(x) === famRe(fam) || patternRe(x).test(fam) || patternRe(fam).test(x);
  const hit = sides.find((x) => x.op === s.op && famOk(x.family) && x.file === file);
  const procOk = hit && procOf(s.process).some((g) => (hit.entries ?? []).some((e) => under(e, g)));
  return { found: !!hit, full: !!procOk, label: `${s.flow}: ${s.process} ${s.op} ${s.family} @ ${s.at}` };
}, "found = a derived hop side (op, family, file); full = attributed to the right process");

if (asJson) { console.log(JSON.stringify(sections, null, 2)); process.exit(0); }
const w = Math.max(...sections.map((s) => s.name.length));
let tf = 0, tt = 0, tfull = 0;
for (const s of sections) {
  tf += s.found; tt += s.total; tfull += s.full;
  console.log(`${s.name.padEnd(w)}  ${String(s.found).padStart(3)}/${String(s.total).padEnd(3)} found  ${String(s.full).padStart(3)} full${s.note ? `   — ${s.note}` : ""}`);
}
console.log(`${"TOTAL".padEnd(w)}  ${String(tf).padStart(3)}/${String(tt).padEnd(3)} found  ${String(tfull).padStart(3)} full`);
if (process.argv.includes("--misses")) for (const s of sections) if (s.misses.length) console.log(`\n${s.name} misses:\n  ${s.misses.slice(0, 40).join("\n  ")}`);
