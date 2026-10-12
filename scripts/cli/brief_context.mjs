// The ratified Brief in a hooked session (2026-10-08). Zero tokens.
//
//   session start   the Function and Method lines (at most 10): every session
//                   starts knowing what the system is for and how it holds
//                   together
//   a prompt        the Method lines whose boxes run a thread the prompt
//                   routes to — once per line per session
//
// Only RATIFIED lines; a proposal reaches no session. Staleness is the
// inbox's and `brief codebase show`'s business (it needs the code's map).
import { loadBrief, allLines } from "../../src/server/brief_store.ts";
import { anchorChange } from "../../src/server/brief_anchor.ts";
import { linesReader } from "../../src/server/node_scope.ts";
// the open facts gaps a prompt touches (the run-time ladder), sent with the Brief's lines
export { gapLinesForPrompt } from "./gap_context.mjs";

const SESSION_MAX = 10;

export function sessionBriefLines(absRoot, files = null) {
  const r = loadBrief(absRoot).ratified;
  if (!r?.spec) return [];
  const fn = r.spec.function ?? [], me = r.spec.method ?? [];
  if (!fn.length && !me.length) return [];
  const lines = [`The Brief (ratified ${r.at.slice(0, 10)} by ${r.by}; each line cites the code and says what kind of evidence it rests on — derived from the code, declared by the project, inferred and ratified by a person, docs; \`vibegraph-knowledge brief codebase show\` marks a stale one):`];
  const kinds = (l) => { const k = evidenceKinds(l.cites); return k.length ? ` [${k.join(" · ")}]` : " [INFERRED — no citation]"; };
  // 2026-10-12 — a line whose cited code changed says so (anchors only: no map is built here)
  const stale = files ? anchorStale(absRoot, r, files) : new Map();
  const mark = (l) => (stale.has(l.text) ? ` [STALE: ${stale.get(l.text)}]` : "");
  for (const l of fn) lines.push(`- Function: ${l.text}${kinds(l)}${mark(l)}`);
  for (const l of me) lines.push(`- Method: ${l.text}${kinds(l)}${mark(l)}`);
  return lines.slice(0, SESSION_MAX + 1);
}

/** The kinds of evidence a Brief line rests on, read off its citations' ids
 *  (2026-10-08, the run-time ladder): no facts are built for it. */
export function evidenceKinds(cites) {
  const kinds = new Set();
  for (const c of cites ?? []) {
    if (/^(rule|plan|topology|spec|label):/.test(c)) kinds.add("declared");
    else if (c.startsWith("claim:")) kinds.add("inferred");
    else if (c.startsWith("note:")) kinds.add("note");
    else if (/\.(md|mdx|txt|rst):\d+$/.test(c)) kinds.add("doc");
    else kinds.add("derived");
  }
  return [...kinds];
}

/** Method lines whose boxes run one of the routed threads, not yet sent this session. */
export function promptBriefLines(absRoot, routedEntryIds, state) {
  const r = loadBrief(absRoot).ratified;
  if (!r?.spec?.method?.length || !routedEntryIds?.length) return [];
  const sent = new Set(state.briefSent ?? []);
  const routed = new Set(routedEntryIds);
  const out = [];
  for (const l of r.spec.method) {
    if (sent.has(l.text) || !(l.entries ?? []).some((e) => routed.has(e))) continue;
    out.push(`- ${l.text}${l.cites?.length ? ` (${l.cites.slice(0, 2).join(", ")})` : ""}`);
    sent.add(l.text);
  }
  state.briefSent = [...sent];
  return out.length ? ["How this part of the system holds together (the ratified Brief):", ...out] : [];
}

/** Ratified line text → why its anchored code changed (file:line citations
 *  only — a rule or plan change needs the map, which `brief codebase show` builds). */
export function anchorStale(absRoot, r, files) {
  const out = new Map();
  if (!r?.spec || !r.anchors) return out;
  const read = linesReader(absRoot);
  for (const l of allLines(r.spec)) for (const c of l.cites ?? []) {
    const a = r.anchors[c];
    const why = a ? anchorChange(a, files, read) : null;
    if (why && !out.has(l.text)) out.set(l.text, why);
  }
  return out;
}

/** After an edit: the ratified lines it touches — a thread behind the line's
 *  boxes walks an edited file, or a function the line cites is in one. Once
 *  per line per session; says whether the cited code changed. */
export function editBriefNote(absRoot, env, files, state) {
  const r = loadBrief(absRoot).ratified;
  if (!r?.spec || !files?.length) return null;
  const edited = new Set(files);
  const walks = new Map((env.threads ?? []).map((t) => [t.entryPointId, new Set(t.filesReached ?? [])]));
  const sent = new Set(state.briefTouched ?? []);
  const stale = anchorStale(absRoot, r, env.files);
  const hit = [];
  for (const l of allLines(r.spec)) {
    if (sent.has(l.text)) continue;
    const viaThread = (l.entries ?? []).find((e) => [...(walks.get(e) ?? [])].some((f) => edited.has(f)));
    const viaCite = (l.cites ?? []).find((c) => r.anchors?.[c] && edited.has(r.anchors[c].file));
    if (!viaThread && !viaCite) continue;
    hit.push(`- "${l.text.slice(0, 140)}" (${viaCite ? `cites ${viaCite}` : `thread ${viaThread}`}) — ${stale.has(l.text) ? `now STALE: ${stale.get(l.text)}` : "its cited code is unchanged"}`);
    sent.add(l.text);
  }
  state.briefTouched = [...sent];
  if (!hit.length) return null;
  return [`This edit touches the ratified Brief (zero tokens; a person re-affirms or re-briefs a stale line: \`vibegraph-knowledge brief codebase show\`; with sync on the app re-drafts it):`, ...hit.slice(0, 6)].join("\n");
}
