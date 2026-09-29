// The post-edit HOOK, in-band (2026-09-29, TODO "The hooks in the app").
//
// `vibegraph-knowledge init --hooks` gives a plain Claude Code session a
// post-edit check: every stated rule re-checked, a NEW violation named with
// its reason and the offending call. A session editing through VibeGraph's
// own chokepoint — the GUI chat, an external `claude mcp add vibegraph`
// session, a work-run worker — had none of it until review. So the check
// rides the edit's own tool result: the stated checks are evaluated before
// the edit and after the derived state settles, and what this edit
// INTRODUCED is said in the same turn the agent made it.
//
// "New" is the derived-gate rule: a violation absent before this edit, or an
// offender added to one that was already violated. An inherited violation is
// counted, not blamed. Pure: rows in, text out.

export interface EditCheckRow {
  id: string;
  source: string;
  described: string;
  rule: string;
  verdict: "pass" | "violated" | "unverifiable";
  reason: string;
  gates: boolean;
  offenders?: string[];
}

export interface EditCheckDiff {
  fresh: Array<{ row: EditCheckRow; added: string[] }>;
  fixed: EditCheckRow[];
  inherited: number;
  total: number;
}

const keyOf = (r: EditCheckRow) => `${r.id}|${r.described}`;

export function diffEditChecks(before: EditCheckRow[], after: EditCheckRow[]): EditCheckDiff {
  const prev = new Map(before.map((r) => [keyOf(r), r]));
  const fresh: EditCheckDiff["fresh"] = [];
  const fixed: EditCheckRow[] = [];
  let inherited = 0;
  for (const a of after) {
    const b = prev.get(keyOf(a));
    if (a.verdict === "violated") {
      const was = b?.verdict === "violated";
      const added = (a.offenders ?? []).filter((o) => !(b?.offenders ?? []).includes(o));
      if (!was || added.length) fresh.push({ row: a, added });
      else inherited++;
    } else if (b?.verdict === "violated") {
      fixed.push(a);
    }
  }
  return { fresh, fixed, inherited, total: after.length };
}

/** The line(s) appended to an edit's tool result; null when the project
 *  states no checkable rule (nothing to say, and silence is honest there). */
export function formatEditCheck(d: EditCheckDiff): string | null {
  if (!d.total) return null;
  const tail = [
    d.inherited ? `${d.inherited} already violated before this edit (not introduced by it)` : "",
    d.fixed.length ? `fixed by this edit: ${d.fixed.map((f) => f.id).join(", ")}` : "",
  ].filter(Boolean).join("; ");
  if (!d.fresh.length) {
    return `Constraint check after this edit: ${d.total} stated rule clause${d.total === 1 ? "" : "s"} re-checked, no new violation${tail ? `; ${tail}` : ""}.`;
  }
  const lines = [
    `Constraint check after this edit: ${d.fresh.length} NEW violation${d.fresh.length === 1 ? "" : "s"} — this edit introduced ${d.fresh.length === 1 ? "it" : "them"}. The rules are the project's stated constraints (\`vibegraph_list_constraints\` has each one's reason); fix it before moving on, or say why the rule does not apply:`,
    ...d.fresh.map(({ row, added }) =>
      `- [${row.id} · ${row.rule}${row.gates ? " · gating: a work-run review would reject this" : " · advisory"}] ${row.described}: ${row.reason}${added.length ? ` (new: ${added.slice(0, 6).join(", ")}${added.length > 6 ? ", …" : ""})` : ""}`),
  ];
  if (tail) lines.push(`Also: ${tail}.`);
  return lines.join("\n");
}
