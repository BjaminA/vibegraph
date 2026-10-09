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
import { loadBrief } from "../../src/server/brief_store.ts";
// the open facts gaps a prompt touches (the run-time ladder), sent with the Brief's lines
export { gapLinesForPrompt } from "./gap_context.mjs";

const SESSION_MAX = 10;

export function sessionBriefLines(absRoot) {
  const r = loadBrief(absRoot).ratified;
  if (!r?.spec) return [];
  const fn = r.spec.function ?? [], me = r.spec.method ?? [];
  if (!fn.length && !me.length) return [];
  const lines = [`The Brief (ratified ${r.at.slice(0, 10)} by ${r.by}; each line cites the code and says what kind of evidence it rests on — derived from the code, declared by the project, inferred and ratified by a person, docs; \`vibegraph-knowledge brief codebase show\` marks a stale one):`];
  const kinds = (l) => { const k = evidenceKinds(l.cites); return k.length ? ` [${k.join(" · ")}]` : " [INFERRED — no citation]"; };
  for (const l of fn) lines.push(`- Function: ${l.text}${kinds(l)}`);
  for (const l of me) lines.push(`- Method: ${l.text}${kinds(l)}`);
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
