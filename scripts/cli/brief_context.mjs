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

const SESSION_MAX = 10;

export function sessionBriefLines(absRoot) {
  const r = loadBrief(absRoot).ratified;
  if (!r?.spec) return [];
  const fn = r.spec.function ?? [], me = r.spec.method ?? [];
  if (!fn.length && !me.length) return [];
  const lines = [`The Brief (ratified ${r.at.slice(0, 10)} by ${r.by}; each line cites the code — \`vibegraph-knowledge brief codebase show\` marks a stale one):`];
  for (const l of fn) lines.push(`- Function: ${l.text}`);
  for (const l of me) lines.push(`- Method: ${l.text}`);
  return lines.slice(0, SESSION_MAX + 1);
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
