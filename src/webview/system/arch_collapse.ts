// The Overview lens draws one box per TOOL CATEGORY, not one per tool
// (reviews/m-arch/COMPARE.md: Archify's example reads well because an
// author chose eight boxes; ours drew every boundary tool — `curl`, `fetch`
// and an unclassified `clsx` each a box, four database clients on
// a private production codebase). The Tools lens still draws each one; nothing is dropped from
// the MODEL, only from this reading of it.
//
//   - two or more tools of one category become `tools:<category>`, whose
//     sublabel names every member and whose edges merge per caller (the
//     protocols joined, counts summed, threads unioned; `members` keeps the
//     original edge ids so a click, a trace or a story can find them);
//   - a tool with an UNCLASSIFIED role is not drawn here; the legend counts
//     it and names the Tools lens;
//   - a tool a stated or proposed GROUP wraps stays its own box: folding it
//     into a category box would draw the group around tools it never named.

import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord } from "../../shared/protocol.ts";
import { ARCH_CATEGORY_LABEL, type ArchCategory } from "../../shared/arch_protocol.ts";

export interface Collapsed { model: ArchModelRecord; hiddenTools: string[] }

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export function collapseTools(model: ArchModelRecord): Collapsed {
  const wrapped = new Set(model.groups.flatMap((g) => g.wraps));
  const tools = model.nodes.filter((n) => n.kind === "tool" && !wrapped.has(n.id));
  const hidden = tools.filter((n) => n.category === "unknown").map((n) => n.id);
  const byCat = new Map<ArchCategory, ArchNodeRecord[]>();
  for (const t of tools) if (t.category !== "unknown") byCat.set(t.category, [...(byCat.get(t.category) ?? []), t]);
  const into = new Map<string, string>();
  const synth: ArchNodeRecord[] = [];
  for (const [cat, list] of [...byCat].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length < 2) continue;
    const id = `tools:${cat}`;
    for (const t of list) into.set(t.id, id);
    const names = list.map((t) => t.label).sort((a, b) => a.localeCompare(b));
    synth.push({
      id, kind: "tool", category: cat, source: "derived",
      label: `${ARCH_CATEGORY_LABEL[cat] ?? cat} · ${list.length}`,
      sublabel: names.join(", "),
      threads: uniq(list.flatMap((t) => t.threads)).sort(),
      refs: list.flatMap((t) => t.refs).slice(0, 8),
      members: list.map((t) => t.id).sort(),
    });
  }
  const gone = new Set([...hidden, ...into.keys()]);
  const nodes = [...model.nodes.filter((n) => !gone.has(n.id)), ...synth];

  const merged = new Map<string, ArchEdgeRecord>();
  const edges: ArchEdgeRecord[] = [];
  for (const e of model.edges) {
    if (hidden.includes(e.to) || hidden.includes(e.from)) continue;
    const to = into.get(e.to);
    if (!to) { edges.push(e); continue; }
    const id = `${e.from}->${to}:uses`;
    const cur = merged.get(id);
    if (!cur) {
      const m: ArchEdgeRecord = {
        ...e, id, to, members: [e.id], protocolBasis: `${e.to}: ${e.protocolBasis}`,
        payloads: undefined, payloadSummary: undefined, details: undefined,
      };
      merged.set(id, m);
      edges.push(m);
    } else {
      cur.members = [...(cur.members ?? []), e.id];
      cur.protocol = uniq([...cur.protocol.split(" / "), e.protocol]).join(" / ");
      cur.protocolBasis = `${cur.protocolBasis}; ${e.to}: ${e.protocolBasis}`;
      cur.count += e.count;
      cur.threads = uniq([...cur.threads, ...e.threads]).sort();
      cur.refs = [...cur.refs, ...e.refs].slice(0, 8);
      cur.via = uniq([...(cur.via ?? []), ...(e.via ?? [])]);
      if (!e.protocolPresence) delete cur.protocolPresence;
      if (e.confidence !== cur.confidence) cur.confidence = "called";
    }
  }
  return { model: { ...model, nodes, edges }, hiddenTools: hidden.sort() };
}
