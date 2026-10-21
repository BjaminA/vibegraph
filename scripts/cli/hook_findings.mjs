// What a hook says about a finding (moved out of hooks.mjs, 2026-10-19, to
// keep it under 500 lines when the hook log arrived). hooks.mjs re-exports
// every name, so its importers are unchanged.
import { verbMayGate } from "../../src/server/quality/standings.ts";

/** What a finding IS across edits: its offender without line numbers
 *  (2026-10-19, PLAN-M-RULES M4 class 3). `layer`, `single-writer`,
 *  `always-with` and `id-scheme` spell an offender `file.ts:41 …`; keyed on
 *  that, an edit ABOVE a violation the tree already had moved its line and the
 *  hooks reported it as one this edit introduced. Structural ids
 *  (`file.py:module/f.fn/x.call`) carry no line and are unchanged. */
export function offenderIdentity(o) {
  return String(o).replace(/(\.[A-Za-z0-9]+):\d+(?::\d+)?\b/g, "$1").replace(/\s*\(lines? \d+(?:, \d+)*\)/g, "");
}

/** Every non-pass verdict, one per offender. */
export function findingsOf(checkResult) {
  const out = [];
  for (const row of checkResult.results) {
    if (row.verdict === "pass") continue;
    const offenders = row.offenders.length ? row.offenders : ["-"];
    for (const o of offenders) {
      out.push({
        key: `${row.id}|${row.rule}|${row.verdict}|${offenderIdentity(o)}`,
        id: row.id, rule: row.rule, verdict: row.verdict, offender: o === "-" ? null : o,
        described: row.described, reason: row.reason,
        gates: row.verdict === "violated" && (row.gates ?? verbMayGate(row.rule)),
      });
    }
  }
  return out;
}

/** At most this many offender lines per check; the rest are counted. */
export const OFFENDERS_PER_CHECK = 5;

/** One block per rule: its stated text (with the reason people wrote), then
 *  each check that failed and where — one line per distinct offender (two
 *  clauses naming the same call are one line), at most OFFENDERS_PER_CHECK a
 *  check, the reason once per check rather than once per offender. */
export function renderFindings(list, textById) {
  const byId = new Map();
  for (const f of list) { if (!byId.has(f.id)) byId.set(f.id, []); byId.get(f.id).push(f); }
  return [...byId].map(([id, fs]) => {
    const byCheck = new Map();
    for (const f of fs) {
      const k = `${f.described}|${f.verdict}`;
      if (!byCheck.has(k)) byCheck.set(k, { f, at: new Set() });
      if (f.offender) byCheck.get(k).at.add(f.offender);
    }
    const lines = [`- [${id}] ${textById.get(id) ?? fs[0].described}`];
    for (const { f, at } of byCheck.values()) {
      const all = [...at];
      const shown = all.slice(0, OFFENDERS_PER_CHECK);
      lines.push(`  check: ${f.described} → ${f.verdict.toUpperCase()}${shown.length ? ` at ${shown.join(", ")}${all.length > shown.length ? ` (+${all.length - shown.length} more)` : ""}` : ""}\n    ${f.reason}`);
    }
    return lines.join("\n");
  }).join("\n");
}

/** When a block is on a rule that may not fit the change: the exact command
 *  to PROPOSE a re-scope (a person accepts it) — never an edit of .vibegraph/. */
export function rescopeHint(list) {
  const ids = [...new Set(list.map((f) => f.id))];
  return `If the rule itself is too narrow for a legitimate change, do not edit .vibegraph/ — propose a re-scope for a person to accept: \`vibegraph-knowledge constraint propose ${ids[0]} --check '<the check as JSON>' --why "<why the change is legitimate>"\` (\`vibegraph-knowledge constraint show ${ids[0]}\` prints the current one).`;
}

/** "[c3] 2 offenders, [c5] 1" — what was already there, in one line. */
export function countLine(list) {
  const by = new Map();
  for (const f of list) { if (!by.has(f.id)) by.set(f.id, new Set()); by.get(f.id).add(f.offender ?? "-"); }
  return [...by].map(([id, s]) => `[${id}] ${s.size} offender${s.size === 1 ? "" : "s"}`).join(", ");
}

/** A few tests by name; many by file (2026-10-07, field report: several
 *  hundred names cut off at the inline limit) — the names are one command away. */
export function testsLine(what, tests, files) {
  const ids = tests.map((t) => t.entryPointId);
  if (ids.length <= 8) return `Discovered tests that reach ${what}: ${ids.join(", ")}`;
  const byFile = new Map();
  for (const id of ids) { const f = id.slice(0, id.lastIndexOf(":")) || id; byFile.set(f, (byFile.get(f) ?? 0) + 1); }
  const parts = [...byFile].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${n} in \`${f}\``);
  const shown = parts.slice(0, 6).join(", ") + (parts.length > 6 ? `, and ${parts.length - 6} more file(s)` : "");
  return `${ids.length} discovered tests reach ${what}: ${shown}. Their names: \`vibegraph-knowledge affected ${files.slice(0, 3).join(" ")}${files.length > 3 ? " …" : ""}\`.`;
}
