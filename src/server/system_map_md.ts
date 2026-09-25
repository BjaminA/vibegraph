// `architecture.md` — the system map as the page an AGENT reads first
// (2026-09-25). The same facts as architecture.vibegraph.json (system_map.ts),
// ordered the way a newcomer needs them: the start-here story, the whole
// system in a dozen arrows, where things run, what each process does and
// talks to, the boundaries, the hops, what crosses them, the stated
// deployment, the subsystems, which threads drive which — and what the map
// leaves out. Dense on purpose: one line per fact, provenance on every line
// that is not derived, long lists capped with the count and a pointer to the
// JSON rather than dropped.
//
// Byte-stable; pure.

import type { ArchEdgeRecord, ArchNodeRecord } from "../shared/protocol.ts";
import type { SystemMap, SystemMapGroupTree } from "./system_map.ts";

const LIST_CAP = 8;
const THREAD_CAP = 25;
const PAYLOAD_CAP = 20;

const tick = (s: string) => "`" + s.replace(/`/g, "'") + "`";
const cap = (items: string[], n = LIST_CAP) =>
  items.length <= n ? items.join(", ") : `${items.slice(0, n).join(", ")} +${items.length - n} more`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const toolName = (id: string) => id.replace(/^tool:/, "");
/** `n thing` / `n things` — a count reads as English ("1 entry point", not "1 entry points"). */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function provenance(source: string, evidence?: string[]): string {
  if (source === "stated") return " — **stated**";
  if (source === "proposed") return evidence && evidence.length ? ` — *proposed* (cites ${evidence.join(", ")})` : " — *proposed, INFERRED*";
  return "";
}

export function renderSystemMapMd(map: SystemMap): string {
  const allNodes = new Map<string, ArchNodeRecord>(map.nodes.map((n) => [n.id, n]));
  for (const v of Object.values(map.views)) for (const n of v.reshaped.nodes) if (!allNodes.has(n.id)) allNodes.set(n.id, n);
  const edgeById = new Map<string, ArchEdgeRecord>(map.edges.map((e) => [e.id, e]));
  const label = (id: string) => allNodes.get(id)?.label ?? toolName(id);
  const epLabel = new Map(map.entryPoints.map((e) => [e.id, e.label]));
  const epFile = new Map(map.entryPoints.map((e) => [e.id, e.file]));
  const groupLabel = new Map(map.groups.map((g) => [g.id, g.label]));
  const s = map.summary;
  const out: string[] = [];
  const push = (...l: string[]) => out.push(...l);

  push(`# ${map.title} — system map`, "");
  push(`Derived from the code by ${map.generator}${map.commit ? ` at ${tick(map.commit)}` : ""}: ` +
    `${count(s.processes, "process", "processes")} · ${count(s.dispatchers, "dispatcher")} · ${count(s.tools, "boundary tool")} · ${count(s.hops, "hop")} between processes · ` +
    `${count(s.groups, "deployment/trust group")} · ${count(s.entryPoints, "entry point")}${s.subsystems ? ` · ${count(s.subsystems, "subsystem")}` : ""}.`, "");
  push("Every line is DERIVED from the code unless marked **stated** (a person decided it) or *proposed* (a model suggested it; nobody has ratified it). " +
    "The same facts as data: `architecture.vibegraph.json` (every record, every lens). The picture, for people: `architecture.html`. " +
    "Per-thread detail: `threads/INDEX.md`; end-to-end chains: `flows.md`; the rules: `constraints.md`.", "");

  // ── start here ──────────────────────────────────────────────────────────
  push("## Start here", "");
  const pp = map.startHere.primaryPath;
  if (pp && pp.entryPoints.length) {
    push(`Primary path${provenance(pp.source, pp.evidence)}: ${pp.entryPoints.map((e) => tick(e)).join(" → ")}`, "");
    map.startHere.story.forEach((b, i) => push(`${i + 1}. **${b.title}** — ${b.caption}`));
    push("");
  } else {
    push("No primary path is stated. Read the Bird's-eye below, then the process with the most entry points. " +
      "(A person can state one in `.vibegraph/architecture.json`, or `vibegraph-knowledge architecture --propose` drafts one for review.)", "");
  }

  // ── bird's-eye ──────────────────────────────────────────────────────────
  const bird = map.views.birdseye;
  const birdEdges = new Map<string, ArchEdgeRecord>([...bird.reshaped.edges.map((e) => [e.id, e] as const)]);
  push("## Bird's-eye", "", `_${bird.purpose}._`, "");
  // One line per source box: what it reaches, and over what.
  const bySource = new Map<string, ArchEdgeRecord[]>();
  for (const id of bird.edges) {
    const e = birdEdges.get(id) ?? edgeById.get(id);
    if (e) bySource.set(e.from, [...(bySource.get(e.from) ?? []), e]);
  }
  for (const [from, list] of bySource) {
    push(`- **${label(from)}** → ${list.map((e) => `${label(e.to)} (${e.protocol}${e.count > 1 ? ` ×${e.count}` : ""})`).join(" · ")}`);
  }
  const quiet = bird.nodes.filter((id) => !bird.edges.some((eid) => { const e = birdEdges.get(eid) ?? edgeById.get(eid); return e && (e.from === id || e.to === id); }));
  if (quiet.length) push(`- also at this height, no arrow: ${quiet.map((id) => `**${label(id)}**`).join(", ")}`);
  if (bird.hidden.processes.length || bird.hidden.tools.length) {
    push(`- not drawn at this height: ${[
      bird.hidden.processes.length ? `${count(bird.hidden.processes.length, "process", "processes")} no hop touches (${cap(bird.hidden.processes.map(label))})` : "",
      bird.hidden.tools.length ? `${count(bird.hidden.tools.length, "less-called tool")} (${cap(bird.hidden.tools.map(toolName))})` : "",
    ].filter(Boolean).join("; ")}`);
  }
  push("");

  // ── hierarchy ───────────────────────────────────────────────────────────
  push("## Where things run", "");
  const nodeLine = (id: string) => {
    const n = allNodes.get(id);
    if (!n) return tick(id);
    const kind = n.kind === "cluster" ? "process" : n.kind === "hub" ? "dispatcher" : n.kind;
    return `${kind} **${n.label}** — ${n.sublabel}${n.labelSource ? provenance(n.labelSource, n.labelEvidence) : ""}`;
  };
  const children = new Map<string, string[]>();
  for (const n of map.nodes) if (n.parent && allNodes.has(n.parent)) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
  const nodeTree = (id: string, depth: number) => {
    push(`${"  ".repeat(depth)}- ${nodeLine(id)}`);
    for (const k of children.get(id) ?? []) nodeTree(k, depth + 1);
  };
  const isChild = (id: string) => { const p = allNodes.get(id)?.parent; return !!p && allNodes.has(p); };
  const groupTree = (g: SystemMapGroupTree, depth: number) => {
    push(`${"  ".repeat(depth)}- **${g.label}** (${g.kind})${provenance(g.source, g.evidence)}`);
    for (const k of g.groups) groupTree(k, depth + 1);
    for (const m of g.members) if (!isChild(m)) nodeTree(m, depth + 1);
  };
  if (map.hierarchy.groups.length) {
    map.hierarchy.groups.forEach((g) => groupTree(g, 0));
    const loose = map.hierarchy.ungrouped.filter((id) => !isChild(id));
    if (loose.length) {
      push("- *(in no stated group)*");
      loose.forEach((id) => nodeTree(id, 1));
    }
  } else {
    push("No deployment or trust group is stated, so this is the derived nesting only (a dispatcher sits under the process it runs in).", "");
    map.hierarchy.ungrouped.filter((id) => !isChild(id) && allNodes.get(id)?.kind !== "tool").forEach((id) => nodeTree(id, 0));
  }
  push("");

  // ── processes ───────────────────────────────────────────────────────────
  push("## Processes", "", "_Each process: what it is, its entry points, the tools it calls, and its hops to and from other processes (the Flows lens). " +
    "A hop's protocol is read from a fact; where that fact is weak (a presence claim, an ambiguous match) the reason is given._", "");
  const outOf = (id: string) => map.edges.filter((e) => e.from === id);
  const into = (id: string) => map.edges.filter((e) => e.to === id && e.kind !== "uses");
  // An entry point's label names it within its file (`main`, `POST`); where
  // two in one process share a label, the file tells them apart.
  const epName = (ids: string[]) => {
    const seen = new Map<string, number>();
    for (const id of ids) { const l = epLabel.get(id) ?? id; seen.set(l, (seen.get(l) ?? 0) + 1); }
    return ids.map((id) => {
      const l = epLabel.get(id) ?? id;
      const file = epFile.get(id);
      return tick((seen.get(l) ?? 0) > 1 && file ? `${file} ${l}` : l);
    });
  };
  for (const n of map.nodes.filter((x) => x.kind === "cluster" || x.kind === "hub")) {
    push(`### ${n.label}`, "");
    const facts = [
      n.kind === "hub" ? "dispatcher" : `${n.family ?? "process"}`,
      n.frameworks?.length ? `frameworks ${n.frameworks.join(", ")}` : "",
      n.root !== undefined ? `root ${tick(n.root || ".")}` : "",
      n.entryPoints ? count(n.entryPoints.length, "entry point") : "",
      n.files ? `${count(n.files, "file")} reached` : "",
      n.group ? `in ${groupLabel.get(n.group) ?? n.group}` : "",
    ].filter(Boolean);
    push(`${tick(n.id)} · ${facts.join(" · ")}`);
    if (n.entryPoints?.length) push(`- entry points: ${cap(epName(n.entryPoints))}`);
    // Most-called first; a funnel by its short module name (the full dotted
    // path is in the JSON's `via`).
    const uses = outOf(n.id).filter((e) => e.kind === "uses").sort((a, b) => b.count - a.count || a.to.localeCompare(b.to));
    const funnel = (via: string[] = []) => via.length ? ` via ${via[0].split(".").pop()}${via.length > 1 ? ` +${via.length - 1}` : ""}` : "";
    if (uses.length) push(`- calls: ${cap(uses.map((e) => `${tick(toolName(e.to))} ${e.protocol}${e.count > 1 ? ` ×${e.count}` : ""}${funnel(e.via)}`), 8)}`);
    // A weak protocol reason is usually shared by every hop of a process
    // (one client imported, not seen called): said once, not per hop.
    const weakWhy = new Set<string>();
    for (const e of outOf(n.id).filter((x) => x.kind !== "uses")) {
      if (e.protocolPresence || e.confidence === "ambiguous") weakWhy.add(e.protocolBasis);
      push(`- → **${label(e.to)}** ${e.kind} ${tick(e.protocol)}${e.details?.length ? ` (${cap(e.details, 4)})` : ""}${e.count > 1 ? ` ×${e.count}` : ""}` +
        `${e.confidence !== "called" && e.confidence !== "path+method" ? `, ${e.confidence}` : ""}${e.protocolPresence ? ", presence" : ""}`);
    }
    for (const why of weakWhy) push(`- weak evidence: ${why}`);
    const ins = into(n.id);
    if (ins.length) push(`- ← from ${ins.map((e) => `**${label(e.from)}** (${e.protocol}${e.count > 1 ? ` ×${e.count}` : ""})`).join(" · ")}`);
    for (const d of n.dispatches ?? []) push(`- runs ${count(d.scripts.length, "script")} in ${tick(d.dir + "/")}: ${cap(d.scripts.map((x) => tick(x.file.split("/").pop() ?? x.file)), 12)}`);
    if (n.callers?.length) push(`- named by: ${cap(n.callers.map(tick), 4)}`);
    for (const note of n.notes ?? []) push(`- note: ${note}`);
    push("");
  }

  // ── boundaries ──────────────────────────────────────────────────────────
  const tools = map.nodes.filter((n) => n.kind === "tool");
  push("## Boundaries (what the processes talk to)", "");
  if (tools.length) {
    push("| tool | category | role | protocol | called by | via | origin |", "|---|---|---|---|---|---|---|");
    for (const t of tools) {
      const callers = map.edges.filter((e) => e.to === t.id && e.kind === "uses");
      const protocol = [...new Set(callers.map((e) => e.protocol))].join(", ") || "—";
      const via = [...new Set(callers.flatMap((e) => e.via ?? []).concat(t.wrappedBy ?? []))];
      push(`| ${cell(tick(t.tool ?? toolName(t.id)))} | ${cell(map.legend.category[t.category] ?? t.category)} | ${cell((t.role ?? "—") + (t.roleStatedBy ? ` (stated by ${t.roleStatedBy})` : ""))} | ${cell(protocol)} | ${cell(cap(callers.map((e) => `${label(e.from)} ×${e.count}`), 4))} | ${cell(cap([...new Set(via.map((v) => v.split(".").pop() ?? v))], 2) || "—")} | ${cell([t.origin, t.version].filter(Boolean).join(" ") || "—")} |`);
    }
  } else push("No boundary tool is called by any thread.");
  push("");

  // ── payloads ────────────────────────────────────────────────────────────
  // The contract BETWEEN processes is what an agent changing one side must
  // keep: every hop's payload, and a tool call's only where the code spells
  // KEYS (a bare call text into a tool — `conn.cursor()` — says nothing the
  // Boundaries table does not). Distinct shapes only.
  const payloadBits = (e: ArchEdgeRecord) => {
    const seen = new Set<string>();
    const bits: string[] = [];
    for (const p of e.payloads ?? []) {
      if (e.kind === "uses" && !p.keys?.length) continue;
      const side = p.side === "caller" ? "sends" : p.side === "callee" ? "accepts" : p.side;
      const what = p.keys?.length ? `keys ${cap(p.keys.map(tick), 8)}` : tick(p.text.length > 60 ? p.text.slice(0, 59) + "…" : p.text);
      const bit = `${side}${p.source !== "derived" ? ` (${p.source})` : ""} ${what}`;
      if (!seen.has(bit)) { seen.add(bit); bits.push(bit); }
    }
    return bits;
  };
  const withPayload = map.edges.map((e) => [e, payloadBits(e)] as const).filter(([, b]) => b.length)
    .sort(([a], [b]) => Number(a.kind === "uses") - Number(b.kind === "uses"));
  push("## What crosses the edges (the Payloads lens)", "");
  if (withPayload.length) {
    for (const [e, bits] of withPayload.slice(0, PAYLOAD_CAP)) {
      push(`- **${label(e.from)}** → **${label(e.to)}** (${e.protocol}): ${cap(bits, 4)}`);
    }
    if (withPayload.length > PAYLOAD_CAP) push(`- +${withPayload.length - PAYLOAD_CAP} more edges with a spelled payload in \`architecture.vibegraph.json\` (\`edges[].payloads\`)`);
  } else push("No edge's payload is spelled in the code the IR reads.");
  push("");

  // ── trust ───────────────────────────────────────────────────────────────
  const trust = map.views.trust;
  push("## Deployment and trust boundaries (the Trust lens)", "");
  if (!map.groups.length) push("None stated. The map cannot say which host or network anything runs in until a person states it (or ratifies a proposal).");
  else if (!trust.edges.length) push("Groups are stated, and no edge crosses from one to another.");
  else {
    push("_Edges that leave one stated host, network or trust zone for another — where a request needs auth, a network path, or a secret._", "");
    const crossing = new Map<string, ArchEdgeRecord[]>();
    for (const id of trust.edges) {
      const e = trust.reshaped.edges.find((x) => x.id === id) ?? edgeById.get(id);
      if (e) crossing.set(e.from, [...(crossing.get(e.from) ?? []), e]);
    }
    for (const [from, list] of crossing) push(`- **${label(from)}** → ${list.map((e) => `${label(e.to)} (${e.protocol})`).join(" · ")}`);
  }
  push("");

  // ── subsystems ──────────────────────────────────────────────────────────
  if (map.subsystems && map.subsystems.subsystems.length) {
    push("## Subsystems (the System view's subsystem tier)", "");
    for (const ss of map.subsystems.subsystems) {
      const bits = [ss.kind, ss.framework ?? "", ss.path ? `at ${tick(ss.path)}` : "", ss.fileCount ? `${ss.fileCount} files` : "",
        ss.threadRefs?.length ? `${ss.threadRefs.length} threads touch it` : ""].filter(Boolean);
      push(`- **${ss.label}** — ${bits.join(" · ")}${ss.evidence ? ` (${ss.evidence})` : ""}`);
    }
    const effects = map.subsystems.edges.filter((e) => e.kind === "effect");
    if (effects.length) push(`- ${effects.length} effect edges (${[...new Set(effects.map((e) => e.effectKind ?? "effect"))].join(", ")}); ${map.subsystems.edges.length - effects.length} call edges`);
    push("");
  }

  // ── threads ─────────────────────────────────────────────────────────────
  if (map.threads) {
    const t = map.threads;
    push("## Which threads drive which (the Threads toggle)", "");
    push(`${count(t.calls.length, "thread-to-thread call")}, ${count(t.hops.length, "hop")} across processes.`);
    const lines = [
      ...t.hops.map((h) => `- ${tick(epLabel.get(h.from) ?? h.from)} → ${tick(epLabel.get(h.to) ?? h.to)} hop ${tick([h.method, h.path].filter(Boolean).join(" "))}, ${h.confidence}`),
      ...t.calls.map((c) => `- ${tick(epLabel.get(c.from) ?? c.from)} → ${tick(epLabel.get(c.to) ?? c.to)} call${c.count > 1 ? ` ×${c.count}` : ""}`),
    ];
    push(...lines.slice(0, THREAD_CAP));
    if (lines.length > THREAD_CAP) push(`- +${lines.length - THREAD_CAP} more in \`architecture.vibegraph.json\` → \`threads\``);
    push("");
  }

  // ── gaps ────────────────────────────────────────────────────────────────
  const u = map.unplaced;
  push("## Not on this map (counted, never dropped)", "");
  push(`- ${count(u.tests, "test entry point")}; ${count(u.unmatchedHops, "hop")} that matched no receiver; ${count(u.unattributedBoundaries, "boundary call site")} no rule attributed to a tool`);
  if (u.toolsPresentNotCalled.length) push(`- imported but never seen called: ${cap(u.toolsPresentNotCalled.map(tick), 12)}`);
  for (const n of map.notes) push(`- ${n}`);
  if (map.proposal) {
    push(`- a proposal from ${map.proposal.model} is PENDING (items marked *proposed* above)${map.proposal.refused.length ? `; refused: ${map.proposal.refused.map((r) => `${r.item} (${r.reason})`).join("; ")}` : ""}`);
    if (map.proposal.narrative) push(`- its narrative, unratified: ${map.proposal.narrative}`);
  }
  push("");
  return out.join("\n");
}
