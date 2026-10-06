// Payload CHIPS on the map's edges (2026-10-06): the label an edge already
// has (its protocol, ×count) plus what moves along it — the operation
// (write / read / watch, from node_io's edgeOps) and the keys the call spells
// — drawn as chips by ArchEdge, in the box the router reserved for the label.
// What does not fit is "+N"; the full list stays in the edge's title and the
// inspector. Pure.

import type { Edge } from "@xyflow/react";
import type { ArchModelRecord, ArchEdgeRecord } from "../../shared/protocol";
import { edgeOps } from "../../shared/node_io.ts";
import { labelBox } from "./archLayout.ts";

export interface EdgeChip { kind: "proto" | "op" | "key" | "more"; text: string }
const width = (c: EdgeChip) => Math.ceil(c.text.length * 6.6) + (c.kind === "proto" ? 4 : 14);

/** The chips one edge shows in `w` pixels. */
export function chipsFor(e: ArchEdgeRecord, model: ArchModelRecord, label: string, w: number): EdgeChip[] | null {
  const to = model.nodes.find((n) => n.id === e.to);
  const ops = edgeOps(e, to).filter((o) => o !== "hop" && o !== "call" && o !== "enforces");
  const keys = [...new Set((e.payloads ?? []).flatMap((p) => (p.side === "caller" || p.side === "callee" ? p.keys ?? [] : [])))];
  // Only keys the CODE spells: a planned boundary's label already says "· N
  // keys · 1 rule" with the keys on hover (arch_plan's planEdgeLabel).
  if (!ops.length && !keys.length) return null; // the plain label says it all
  // What moves first (the operation, then the keys); the protocol only when
  // it is short and the lens's label is not itself a payload summary.
  const proto = label.replace(/^(write|read|watch)( · )?/, "").trim();
  const showProto = proto && proto.length <= 14 && !/[{]|shape|keys/.test(proto);
  const want: EdgeChip[] = [
    ...ops.map((o) => ({ kind: "op" as const, text: o })),
    ...keys.map((k) => ({ kind: "key" as const, text: k })),
    ...(showProto ? [{ kind: "proto" as const, text: proto }] : []),
  ];
  const out: EdgeChip[] = [];
  let used = 0;
  for (let i = 0; i < want.length; i++) {
    const c = want[i];
    const rest = want.length - i - 1;
    const more = rest ? width({ kind: "more", text: `+${rest}` }) + 4 : 0;
    const room = w - used - (out.length ? 4 : 0) - more;
    if (width(c) <= room) { out.push(c); used += (out.length > 1 ? 4 : 0) + width(c); continue; }
    // the first chip always shows, cut to fit; later ones become "+N"
    if (!out.length && room > 30) { const n = Math.max(2, Math.floor((room - 14) / 6.6) - 1); out.push({ ...c, text: `${c.text.slice(0, n)}…` }); used = room; continue; }
    out.push({ kind: "more", text: `+${want.length - i}` });
    break;
  }
  return out;
}

/** Put chips on every laid-out edge that carries an operation or keys. A
 *  refused ATTEMPT (attempts.ts) is drawn red and dashed whatever its label. */
export function chipEdges(edges: Edge[], model: ArchModelRecord): Edge[] {
  return edges.map((e0) => {
    const rec = (e0.data as { edge?: ArchEdgeRecord } | undefined)?.edge;
    const e = rec?.protocol === "attempt" ? { ...e0, style: { ...e0.style, stroke: "var(--accent-error)", strokeDasharray: "4 4" }, data: { ...e0.data, attempt: true } } : e0;
    if (!rec || e.label === undefined) return e;
    const label = String(e.label ?? "");
    // exactly the room the router reserved for the label: no wider, or a chip
    // would sit on a card or another label
    const chips = chipsFor(rec, model, label, Math.max(labelBox(label).w, 80));
    return chips ? { ...e, data: { ...e.data, chips } } : e;
  });
}
