// The vertical room container chrome needs between thread rows (2026-10-02).
import { chipLabel, chipLines, CHIP_LINE_H } from "./chipPlacement";
import type { Thread } from "./types";
import { homeMembers } from "./containerHome";
import type { Placement } from "./useThreadLayout";

// 2026-10-02 — room for container chrome BETWEEN rows. A fixed lane stride
// (140) assumed one container level; a try > for > finally nest, or a chip
// wrapped onto two lines, needs more, and the boxes then overlapped the row
// above (a FINALLY chip buried under the box before it). The gap above a row
// is the chrome of the containers that START on it (padding, chip overhang,
// a nesting margin per level, a wrapped chip's extra line) plus the chrome of
// those that END on the row before it. Mirrors ThreadView's box constants; a
// chip counts at its narrowest box, so a wrapped line is never under-reserved.
export const CARD_H = 75;
const BOX_PAD_TOP = 18;
const BOX_PAD_BOTTOM = 10;
const BOX_NEST_TOP = 26;
const BOX_NEST = 10;
const CHIP_OVERHANG = 10;
const CHROME_CLEAR = 12;
/** `placedBy` — the layout's placer per card: a container's chrome is reserved
 *  around the members drawn at its own call site only (containerHome.ts), and
 *  `xOf` — only those in the column of its own calls, the same cards
 *  ThreadView draws the box around. */
export function rowGapsFor(thread: Thread, rowOf: Map<string, number>, placedBy?: Map<string, Placement>, xOf?: (id: string) => number | undefined): Map<number, number> {
  const kids = new Map<string, string[]>();
  for (const e of thread.edges) if (e.kind === "contains") { if (!kids.has(e.from)) kids.set(e.from, []); kids.get(e.from)!.push(e.to); }
  const containers = thread.nodes.filter((n) => n.kind === "container");
  const isContainer = new Set(containers.map((c) => c.id));
  const home = homeMembers(thread.nodes, placedBy, kids);
  const leavesMemo = new Map<string, string[]>();
  const leaves = (id: string, seen: Set<string> = new Set()): string[] => {
    const memo = leavesMemo.get(id);
    if (memo) return memo;
    if (seen.has(id)) return [];
    seen.add(id);
    const out = (kids.get(id) ?? []).flatMap((k) => (isContainer.has(k) ? leaves(k, seen) : rowOf.has(k) ? [k] : []));
    leavesMemo.set(id, out);
    return out;
  };
  const top = new Map<number, number>();
  const bottom = new Map<number, number>();
  // per (row, leaf): the containers starting / ending there that hold it
  const startChain = new Map<string, { n: number; extra: number }>();
  const endChain = new Map<string, number>();
  for (const c of containers) {
    const homeLs = leaves(c.id).filter((l) => home(c.id, l));
    const column = xOf ? Math.min(...homeLs.map((l) => xOf(l) ?? Infinity)) : 0;
    const ls = xOf ? homeLs.filter((l) => (xOf(l) ?? Infinity) === column) : homeLs;
    if (!ls.length) continue;
    const rows = ls.map((l) => rowOf.get(l)!);
    const first = Math.min(...rows), last = Math.max(...rows);
    const extra = (chipLines(chipLabel(String(c.label ?? ""))) - 1) * CHIP_LINE_H;
    for (const l of ls) {
      if (rowOf.get(l) === first) { const k = `${first}|${l}`; const v = startChain.get(k) ?? { n: 0, extra: 0 }; startChain.set(k, { n: v.n + 1, extra: v.extra + extra }); }
      if (rowOf.get(l) === last) { const k = `${last}|${l}`; endChain.set(k, (endChain.get(k) ?? 0) + 1); }
    }
  }
  for (const [k, v] of startChain) {
    const r = Number(k.split("|")[0]);
    top.set(r, Math.max(top.get(r) ?? 0, BOX_PAD_TOP + CHIP_OVERHANG + (v.n - 1) * BOX_NEST_TOP + v.extra));
  }
  for (const [k, n] of endChain) {
    const r = Number(k.split("|")[0]);
    bottom.set(r, Math.max(bottom.get(r) ?? 0, BOX_PAD_BOTTOM + (n - 1) * BOX_NEST));
  }
  const gaps = new Map<number, number>();
  const rowsSorted = [...new Set(rowOf.values())].sort((a, b) => a - b);
  for (let i = 1; i < rowsSorted.length; i++) {
    const r = rowsSorted[i], prev = rowsSorted[i - 1];
    gaps.set(r, (bottom.get(prev) ?? 0) + (top.get(r) ?? 0) + CHROME_CLEAR);
  }
  return gaps;
}
