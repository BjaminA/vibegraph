// ANCHORED CITATIONS (2026-10-12, field report: two Brief lines read STALE
// although nothing they described had changed). A `file:line` citation was
// checked against the lines printed in THIS run's facts pack — which keeps only
// the top-ranked items — so a line that fell out of the ranking, or moved
// because code above it changed, read "no longer among the facts". Now each
// `file:line` is anchored when it is written: to the innermost function or
// class around the line (its structural id and a hash of its source), or, at
// module level and in docs, to the line's own text. Staleness asks the anchor:
// is that function still there and unchanged, is that line still in the file?
// Where it is in the file, and whether it made today's pack, does not matter.
// Zero tokens; the same check runs in the server, the CLI and the hooks.

import { createHash } from "node:crypto";

export interface BriefAnchor { file: string; line: number; id?: string; hash: string; text: string }

type IrNode = { id: string; type?: string; line?: number; endLine?: number };
type Files = Record<string, { nodes?: IrNode[] } | undefined> | null | undefined;
type Lines = (file: string) => string[] | null;

const FILE_LINE = /^(.+):(\d+)$/;
const SCOPES = new Set(["function_def", "class_def"]);
const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const nameOf = (id: string) => (id.split("/").pop() ?? id).replace(/\.(fn|class)$/, "");

/** The anchor of a `file:line` citation, or null for any other kind. */
export function anchorOf(cite: string, files: Files, readLines: Lines): BriefAnchor | null {
  const m = FILE_LINE.exec(cite);
  if (!m) return null;
  const file = m[1], line = Number(m[2]);
  const lines = readLines(file);
  if (!lines || line < 1 || line > lines.length) return null;
  const text = lines[line - 1].trim();
  let fn: IrNode | undefined;
  for (const n of files?.[file]?.nodes ?? []) {
    if (!SCOPES.has(n.type ?? "") || typeof n.line !== "number" || typeof n.endLine !== "number") continue;
    if (n.line <= line && line <= n.endLine && (!fn || n.line >= fn.line!)) fn = n;
  }
  if (fn) return { file, line, id: fn.id, hash: h(lines.slice(fn.line! - 1, fn.endLine).join("\n")), text };
  return { file, line, hash: h(text), text };
}

/** What became of an anchor: null when it still holds, else why. A file that
 *  cannot be read now is not known to have changed, so it is not called so. */
export function anchorChange(a: BriefAnchor, files: Files, readLines: Lines): string | null {
  const lines = readLines(a.file);
  if (!lines) return null;
  if (a.id) {
    const n = (files?.[a.file]?.nodes ?? []).find((x) => x.id === a.id && SCOPES.has(x.type ?? ""));
    if (!n || typeof n.line !== "number" || typeof n.endLine !== "number") return `${a.file}: ${nameOf(a.id)} is gone (renamed, moved or removed)`;
    return h(lines.slice(n.line - 1, n.endLine).join("\n")) === a.hash ? null : `${a.file}: the code of ${nameOf(a.id)} changed`;
  }
  return lines.some((l) => l.trim() === a.text) ? null : `${a.file}:${a.line} — the cited line is no longer in the file`;
}

/** Anchors for every `file:line` among `cites`. */
export function anchorsFor(cites: Iterable<string>, files: Files, readLines: Lines): Record<string, BriefAnchor> {
  const out: Record<string, BriefAnchor> = {};
  for (const c of cites) { const a = anchorOf(c, files, readLines); if (a) out[c] = a; }
  return out;
}

/** A plan citation's text without its trailing status: what a line says about
 *  a planned item does not change when the item goes from agreed to proposed. */
export const planSansStatus = (s: string) => s.replace(/\s*\((agreed|proposed|built|dropped|open|closed|realised)\)\s*$/, "").trim();
