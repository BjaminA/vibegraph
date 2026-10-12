// KEEPING THE BRIEF CURRENT (2026-10-12). Three pieces, none of which spends a
// token on its own:
//   - RE-AFFIRM: a person says a STALE line still holds; its citations are
//     stamped against the code as it is now (the skills' Re-affirm, for the
//     Brief). Clears lines whose staleness was the check's, not the code's.
//   - the FOCUS of a re-brief: only the boxes the stale lines rest on (and the
//     ones next to them), so re-drafting two lines does not resend the project
//   - SYNC: a person switches it on; when the code a ratified line cites
//     changes, the server re-drafts just the stale lines (one small call, at
//     most one per quiet period) and keeps them PROPOSED for the person.

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { BriefLine, BriefRecord } from "../shared/brief_types.ts";
import { hash16, type BriefFacts } from "./brief_facts.ts";
import { allLines, briefWithStaleness, loadBrief, saveBrief } from "./brief_store.ts";

/** The ratified lines that read STALE against these facts. */
export function staleBriefLineList(rec: BriefRecord, facts: BriefFacts): BriefLine[] {
  const r = briefWithStaleness(rec, facts);
  return r?.spec ? allLines(r.spec).filter((l) => l.stale?.length) : [];
}

/** A person: these ratified lines still hold (all stale ones when `texts` is
 *  absent). Their citations are stamped against the code as it is now. */
export function reaffirmBrief(root: string, facts: BriefFacts, who: string, texts?: string[] | null, now: Date = new Date()): { ok: boolean; detail: string } {
  const rec = loadBrief(root);
  const r = rec.ratified;
  if (!r?.spec) return { ok: false, detail: "no ratified Brief to re-affirm" };
  const chosen = texts?.length ? new Set(texts) : new Set(staleBriefLineList(rec, facts).map((l) => l.text));
  const lines = allLines(r.spec).filter((l) => chosen.has(l.text));
  if (!lines.length) return { ok: false, detail: texts?.length ? "no ratified line has that text" : "no ratified line is stale" };
  let stamped = 0;
  const gone: string[] = [];
  for (const l of lines) for (const c of l.cites) {
    const content = facts.cites.get(c) ?? facts.reread?.(c) ?? null;
    if (content === null) { gone.push(c); continue; }
    r.hashes[c] = hash16(content);
    (r.basis ??= {})[c] = content.replace(/\s+/g, " ").slice(0, 160);
    const a = facts.anchorAt?.(c);
    if (a) (r.anchors ??= {})[c] = a; else if (r.anchors) delete r.anchors[c];
    const code = facts.code.get(c);
    if (code) (r.codeHashes ??= {})[c] = code;
    stamped++;
  }
  r.scheme = 2;
  rec.history = [...(rec.history ?? []), { at: now.toISOString(), by: who, section: "spec", decision: "reaffirm" as const, model: r.model }].slice(-50);
  saveBrief(root, rec);
  return { ok: true, detail: `${lines.length} line${lines.length === 1 ? "" : "s"} re-affirmed by ${who}: ${stamped} citation${stamped === 1 ? "" : "s"} stamped against the code as it is now${gone.length ? `; ${gone.length} cite something no longer there (${gone.slice(0, 3).join(", ")}) and stay stale — re-brief those` : ""}` };
}

/** What a re-brief of these lines needs to see: the boxes they name, the ends
 *  of the edges they cite, and the citations themselves. */
export function staleFocus(model: ArchModelRecord, lines: BriefLine[]): { boxes: Set<string>; cites: Set<string> } {
  const cites = new Set(lines.flatMap((l) => l.cites));
  const boxes = new Set(lines.flatMap((l) => l.boxes ?? []));
  for (const n of model.nodes) if (cites.has(n.id)) boxes.add(n.id);
  for (const e of model.edges) if (cites.has(e.id)) { boxes.add(e.from); boxes.add(e.to); }
  return { boxes, cites };
}

/** A person switches SYNC on or off. */
export function setBriefSync(root: string, on: boolean, who: string, now: Date = new Date()): { ok: boolean; detail: string } {
  const rec = loadBrief(root);
  rec.sync = { ...(rec.sync ?? {}), on, by: who, at: now.toISOString() };
  saveBrief(root, rec);
  return { ok: true, detail: on
    ? `Brief sync ON (by ${who}): when the code a ratified line cites changes, its stale lines are re-drafted — one small call each time, at most one per ${SYNC_GAP_MIN} minutes — and wait for you as a proposal`
    : `Brief sync off (by ${who}): stale lines are marked, nothing is re-drafted on its own` };
}

export const SYNC_GAP_MIN = 10;

/** Is a sync re-draft due: on, a ratified spec, stale lines, nothing waiting
 *  for a person, and the quiet period since the last run has passed. */
export function syncDue(rec: BriefRecord, staleCount: number, nowMs: number = Date.now()): boolean {
  if (!rec.sync?.on || !rec.ratified?.spec || !staleCount || rec.proposed) return false;
  const last = rec.sync.lastRun ? Date.parse(rec.sync.lastRun) : 0;
  return nowMs - last >= Number(process.env.VG_BRIEF_SYNC_GAP_MS ?? SYNC_GAP_MIN * 60_000);
}

export function markSyncRun(root: string, now: Date = new Date()): void {
  const rec = loadBrief(root);
  if (!rec.sync) return;
  rec.sync.lastRun = now.toISOString();
  saveBrief(root, rec);
}
