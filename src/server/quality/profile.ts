// Quality layer, Run 3: the stack-profile DERIVER. Pure over a project
// envelope and its stack index; writes nothing. Every fact names the
// envelope surface it was read from and at least one node it was read
// at; a fact with no node is dropped and reported in `notes`, never
// defaulted. Regimes are tags derived by the rules in REGIME_RULES, each
// naming the facts it read. What the source cannot yield is listed under
// `unknowns` with its reason. Output validates against
// schemas/quality/stack_profile.json (test/quality_derived.test.mjs).

import { computeThreadContract, type ThreadContract } from "../thread_contract.ts";
import { buildCrossingIndex } from "../crossings.ts";
import type { StackIndex } from "../stack.ts";
import { contractOptsFor, type EnvelopeLike } from "./facts.ts";
import type { ProfileFact } from "./predicate.ts";
import { languageForPath } from "../../shared/languages.ts";

type Confidence = "exact" | "attributed" | "file-level";
interface Regime { id: string; derivedFrom: string[]; reason?: string }
export interface StackProfile {
  version: "1.0";
  project: string;
  provenance: { kind: "derived"; by: string; commit: string; at: string };
  facts: Record<string, ProfileFact>;
  regimes: Regime[];
  unknowns: Array<{ fact: string; reason: string }>;
  threads: Record<string, { facts: Record<string, ProfileFact>; regimes: Regime[] }>;
}

const BY = "src/server/quality/profile.ts";
const EFFECTFUL_ROLES = new Set(["db", "http-client", "process", "remote", "queue", "cache", "cloud"]);

/** Confidence from the attribution ladder's `how`. */
function confidenceOf(how: string | undefined): Confidence {
  if (how === "qualified" || how === "call-site" || how === "binding") return "exact";
  if (how === "funnel-file") return "file-level";
  return "attributed";
}

class FactSet {
  facts: Record<string, ProfileFact> = {};
  notes: string[] = [];
  private where: string;
  // Not a parameter property: Node's strip-only TypeScript refuses those.
  constructor(where: string) { this.where = where; }
  add(name: string, value: string[] | boolean, confidence: Confidence, nodes: Iterable<string>, readFrom: string) {
    const supportingNodes = [...new Set(nodes)].filter((n) => /^[^:]+:module(\/[^/]+)*$/.test(n));
    if (!supportingNodes.length) { this.notes.push(`${this.where}: fact ${name} dropped — no supporting node (an unsupported fact is an assertion)`); return; }
    this.facts[name] = { value, confidence, supportingNodes, readFrom };
  }
}

const REGIME_RULES: Array<{ id: string; when: (f: Record<string, ProfileFact>) => string[] | null }> = [
  { id: "http-service", when: (f) => has(f, "entryKinds", "route") ? ["entryKinds"] : null },
  { id: "cli-tool", when: (f) => has(f, "entryKinds", "cli") ? ["entryKinds"] : null },
  { id: "test-suite", when: (f) => has(f, "entryKinds", "test") ? ["entryKinds"] : null },
  { id: "ml-model", when: (f) => has(f, "entryKinds", "model") ? ["entryKinds"] : has(f, "rolesCalled", "tensor") ? ["rolesCalled"] : null },
  { id: "ops-script", when: (f) => has(f, "languages", "bash") && (has(f, "subsystems", "subprocess") || has(f, "subsystems", "remote") || has(f, "rolesPresent", "process") || has(f, "rolesPresent", "remote")) ? ["languages", has(f, "subsystems", "subprocess") || has(f, "subsystems", "remote") ? "subsystems" : "rolesPresent"] : null },
  { id: "library", when: (f) => { const k = f.entryKinds?.value; return Array.isArray(k) && k.length > 0 && k.every((x) => x === "public_api") ? ["entryKinds"] : null; } },
  { id: "polyglot", when: (f) => { const l = f.languages?.value; return Array.isArray(l) && l.length > 1 ? ["languages"] : null; } },
];
function has(f: Record<string, ProfileFact>, name: string, v: string): boolean {
  const x = f[name]?.value;
  return Array.isArray(x) ? x.includes(v) : x !== undefined && String(x) === v;
}
function regimesFor(f: Record<string, ProfileFact>): Regime[] {
  const out: Regime[] = [];
  for (const r of REGIME_RULES) { const d = r.when(f); if (d) out.push({ id: r.id, derivedFrom: [...new Set(d)] }); }
  if (!out.length) {
    const kinds = Array.isArray(f.entryKinds?.value) ? f.entryKinds.value.join(",") : "none";
    out.push({ id: "unknown", derivedFrom: Object.keys(f).length ? Object.keys(f).slice(0, 1) : ["languages"], reason: `no regime rule matched (entry kinds: ${kinds}; roles called: ${Array.isArray(f.rolesCalled?.value) ? f.rolesCalled.value.join(",") : "none"})` });
  }
  return out;
}

export function deriveStackProfile(env: EnvelopeLike, stack: StackIndex, opts: { project: string; commit: string }): { profile: StackProfile; notes: string[] } {
  const notes: string[] = [];
  const P = new FactSet("project");
  const fileOfNode = (id: string) => Object.entries(env.files).find(([, ir]) => (ir.nodes ?? []).some((n) => n.id === id))?.[0] ?? null;

  // languages
  const byLang = new Map<string, string>();
  // Stamped language first, REGISTRY second (a payload predating the stamp),
  // `unknown` last. Was a hardcoded `.py` check — extension routing outside
  // the registry, which the language audit exists to catch.
  for (const [file, ir] of Object.entries(env.files)) { const l = ir.language ?? languageForPath(file)?.id ?? "unknown"; if (!byLang.has(l)) byLang.set(l, `${file}:module`); }
  P.add("languages", [...byLang.keys()].sort(), "exact", byLang.values(), "files[].language");
  // entry kinds, frameworks, tests
  const byKind = new Map<string, string>();
  const byFw = new Map<string, string>();
  for (const e of env.entryPoints) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, `${e.file}:${e.irNodeId}`);
    if (e.framework && !byFw.has(e.framework)) byFw.set(e.framework, `${e.file}:${e.irNodeId}`);
  }
  P.add("entryKinds", [...byKind.keys()].sort(), "exact", byKind.values(), "entryPoints[].kind");
  P.add("frameworks", [...byFw.keys()].sort(), "exact", byFw.size ? byFw.values() : byKind.values(), "entryPoints[].framework");
  // stack roles present, funnels
  const rolePresent = new Map<string, string>();
  const funnels = new Map<string, string>();
  const roleOfTool = new Map<string, string>();
  for (const t of stack.tools ?? []) {
    roleOfTool.set(t.tool, t.role);
    const ev = t.evidence?.[0];
    const node = ev ? `${ev.file}:${ev.nodeId ?? "module"}` : null;
    if (!node) continue;
    if (t.origin !== "project" && !rolePresent.has(t.role)) rolePresent.set(t.role, node);
    if (t.wraps?.length && !funnels.has(t.tool)) funnels.set(t.tool, node);
  }
  P.add("rolesPresent", [...rolePresent.keys()].sort(), "exact", rolePresent.values(), "stack.tools[].role (origin != project)");
  if (funnels.size) P.add("funnels", [...funnels.keys()].sort(), "exact", funnels.values(), "stack.tools[].wraps");
  else notes.push("project: no funnel (no project module wraps a tool and is imported elsewhere)");
  const testTool = [...(stack.tools ?? [])].find((t) => t.role === "test" && t.evidence?.[0]);
  const testEntry = env.entryPoints.find((e) => e.kind === "test");
  P.add("testsPresent", !!(testTool || testEntry), "exact",
    [testEntry ? `${testEntry.file}:${testEntry.irNodeId}` : testTool ? `${testTool.evidence[0].file}:${testTool.evidence[0].nodeId ?? "module"}` : `${Object.keys(env.files)[0]}:module`],
    "entryPoints[].kind == test, stack.tools[].role == test");
  // subsystems
  const subs = new Map<string, string>();
  const byEp = new Map(env.entryPoints.map((e) => [e.id, e]));
  for (const s of (env as unknown as { system?: { subsystems?: Array<{ kind: string; endpointRefs?: string[] }> } }).system?.subsystems ?? []) {
    const ep = s.endpointRefs?.map((id) => byEp.get(id)).find(Boolean);
    if (ep && !subs.has(s.kind)) subs.set(s.kind, `${ep.file}:${ep.irNodeId}`);
  }
  if (subs.size) P.add("subsystems", [...subs.keys()].sort(), "exact", subs.values(), "system.subsystems[].kind (via endpointRefs)");
  else notes.push("project: subsystems not recorded — none carries an endpoint ref to cite");

  // per thread, from the contracts
  const opts2 = contractOptsFor(env, stack);
  const crossings = buildCrossingIndex(env as never);
  const threads: StackProfile["threads"] = {};
  const calledProject = new Map<string, { node: string; conf: Confidence }>();
  const loopNodes: string[] = [];
  const unattributedNodes: string[] = [];
  let crossingNodes: string[] = [];
  for (const t of env.threads) {
    const ep = t.entryPointId;
    if (!ep) continue;
    let c: ThreadContract;
    try { c = computeThreadContract(t, opts2 as never); } catch (e) { notes.push(`${ep}: contract failed (${(e as Error).message})`); continue; }
    const T = new FactSet(ep);
    const entry = byEp.get(ep);
    if (entry) T.add("entryKinds", [entry.kind], "exact", [`${entry.file}:${entry.irNodeId}`], "entryPoints[].kind");
    T.add("languages", [c.language], "exact", [`${t.seed.file}:module`], "files[].language");
    const called = new Map<string, { node: string; conf: Confidence }>();
    for (const ex of c.externals) {
      if (!ex.tool || !ex.irNodeId) continue;
      const file = fileOfNode(ex.irNodeId) ?? t.seed.file;
      const node = `${file}:${ex.irNodeId}`;
      const conf = confidenceOf(ex.tool.how);
      if (!called.has(ex.tool.role)) called.set(ex.tool.role, { node, conf });
      if (!calledProject.has(ex.tool.role)) calledProject.set(ex.tool.role, { node, conf });
    }
    if (called.size) {
      const confs = [...called.values()].map((x) => x.conf);
      T.add("rolesCalled", [...called.keys()].sort(), confs.includes("file-level") ? "file-level" : confs.includes("attributed") ? "attributed" : "exact", [...called.values()].map((x) => x.node), "contract.externals[].tool.role");
    }
    if (c.roundTrips.length) {
      const nodes = c.roundTrips.map((rt) => `${rt.file ?? t.seed.file}:${(t.nodes as Array<{ id: string; irNodeId?: string | null }>).find((n) => n.id === rt.loop)?.irNodeId ?? "module"}`);
      T.add("effectfulLoops", true, "attributed", nodes, "contract.roundTrips[]");
      loopNodes.push(...nodes);
    }
    const un = c.externals.filter((ex) => ex.kind === "external" && !ex.tool && ex.irNodeId).map((ex) => `${fileOfNode(ex.irNodeId!) ?? t.seed.file}:${ex.irNodeId}`);
    if (un.length) { T.add("unattributedBoundaries", true, "exact", un, "contract.boundaries.unattributed"); unattributedNodes.push(...un); }
    const xs = (crossings.byThread as unknown as Record<string, Array<Record<string, unknown>>>)[ep] ?? [];
    if (xs.length) {
      const nodes = xs.map((x) => { const from = x.from as { file?: string; irNodeId?: string } | undefined; return from?.file && from?.irNodeId ? `${from.file}:${from.irNodeId}` : `${t.seed.file}:${t.seed.irNodeId}`; });
      T.add("crossings", true, "exact", nodes, "crossings.byThread[]");
      crossingNodes.push(...nodes);
    }
    threads[ep] = { facts: T.facts, regimes: regimesFor({ ...P.facts, ...T.facts }) };
    notes.push(...T.notes);
  }
  if (calledProject.size) {
    const confs = [...calledProject.values()].map((x) => x.conf);
    P.add("rolesCalled", [...calledProject.keys()].sort(), confs.includes("file-level") ? "file-level" : confs.includes("attributed") ? "attributed" : "exact", [...calledProject.values()].map((x) => x.node), "contract.externals[].tool.role (any thread)");
  }
  if (loopNodes.length) P.add("effectfulLoops", true, "attributed", loopNodes, "contract.roundTrips[] (any thread)");
  if (unattributedNodes.length) P.add("unattributedBoundaries", true, "exact", unattributedNodes, "contract.boundaries.unattributed (any thread)");
  if (crossingNodes.length) P.add("crossings", true, "exact", crossingNodes, "crossings.byThread[] (any thread)");
  notes.push(...P.notes);

  const profile: StackProfile = {
    version: "1.0",
    project: opts.project,
    provenance: { kind: "derived", by: BY, commit: opts.commit, at: new Date().toISOString() },
    facts: P.facts,
    regimes: regimesFor(P.facts),
    unknowns: [
      { fact: "hotPaths", reason: "only a trace says which loops iterate a lot; the IR sees the loop, not its count" },
      { fact: "dataVolume", reason: "not in the code; state it as a constraint" },
      { fact: "latencyBudget", reason: "not in the code; state it as a constraint" },
      { fact: "deploymentTarget", reason: "not in the code; a deploy script's PATH resolves on the deploy host, not here (M-TABLES)" },
      { fact: "consumers", reason: "who reads an output is not in the code (fleet c2's BI job is a stated fact)" },
    ],
    threads,
  };
  void EFFECTFUL_ROLES;
  return { profile, notes };
}
