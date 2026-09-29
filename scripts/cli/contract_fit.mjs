// Fitting a thread contract into the hooks' inline limit (2026-09-29).
//
// A contract is SECTIONS, not a node list, and cutting it from the end —
// what a plain length limit does — drops the last section, "Where static
// knowledge ends", which is the line that tells a reader the picture is
// incomplete. Ranking by node (primary / secondary) would not help either:
// the long parts are the external-call and boundary LISTS, which are
// primary-level already. So a contract that does not fit is shrunk by
// section priority, in this order:
//
//   1. the Stack line goes first — tools the files merely import, the least
//      a reader of this thread needs;
//   2. long lists are shortened: each keeps its first items and says how
//      many are held back;
//   3. then a whole list section is held back;
//   4. last, round-trip and crossing lists keep their first items.
//
// The header (seed, what enters and leaves) and the closing block
// (neighbouring threads, tests, environment, where knowledge ends) are never
// cut; if even they do not fit, the caller defers the whole contract. Whatever was held back is returned by key, so the next
// prompt that names the thread sends exactly that ("partly sent", not "sent").

const KEEP_ITEMS = 6;

/** Paragraph blocks, as formatContractBlock separates them with blank lines. */
export function contractSections(text) {
  const blocks = text.split("\n\n");
  return blocks.map((body, i) => {
    const first = body.split("\n")[0];
    const key = `${i}:${first.slice(0, 60)}`;
    const priority = i === 0 || i === blocks.length - 1 ? 0
      : /^(Round trips|Crosses into)/.test(first) ? 1
        : /^Stack \(/.test(first) ? 3
          : 2;
    return { key, body, priority };
  });
}

/** Keep a list section's first `keep` items (with their continuation
 *  lines); null when it is already that short. */
function shortenList(body, keep) {
  const lines = body.split("\n");
  if (lines.filter((l) => l.startsWith("- ")).length <= keep) return null;
  const out = [];
  let items = 0, held = 0, keeping = true;
  for (const l of lines) {
    if (l.startsWith("- ")) { items++; keeping = items <= keep; if (!keeping) held++; }
    if (keeping) out.push(l);
  }
  out.push(`- [${held} more held back for length — they arrive the next time a prompt names this thread, and the export has them all]`);
  return out.join("\n");
}

/**
 * @returns {{ text: string, held: string[] } | null}  null when even the
 *   sections that are never cut do not fit `room`.
 */
export function fitContract(text, room) {
  if (text.length <= room) return { text, held: [] };
  const sections = contractSections(text).map((s) => ({ ...s, out: s.body, held: false }));
  const size = () => sections.filter((s) => s.out !== null).reduce((n, s) => n + s.out.length + 2, 0);
  const stages = [
    () => { for (const s of sections) if (s.priority === 3) { s.out = null; s.held = true; } },
    () => { for (const s of sections) if (s.priority === 2) { const short = shortenList(s.body, KEEP_ITEMS); if (short) { s.out = short; s.held = true; } } },
    () => { for (const s of sections) if (s.priority === 2) { const short = shortenList(s.body, 2); if (short) { s.out = short; s.held = true; } } },
    () => { for (const s of [...sections].reverse()) { if (size() <= room) break; if (s.priority === 2) { s.out = null; s.held = true; } } },
    // Last: round trips and crossings keep their first items too (their
    // heads stay, so a reader still sees the section exists).
    () => { for (const s of sections) if (s.priority === 1) { const short = shortenList(s.body, 2); if (short) { s.out = short; s.held = true; } } },
  ];
  for (const stage of stages) {
    if (size() <= room) break;
    stage();
  }
  if (size() > room) return null;
  const held = sections.filter((s) => s.held).map((s) => s.key);
  const dropped = sections.filter((s) => s.out === null).length;
  const body = sections.filter((s) => s.out !== null).map((s) => s.out).join("\n\n");
  const note = `(This contract was shortened to fit Claude Code's inline limit${dropped ? `; ${dropped} section(s) held back` : ""}. What was held back arrives the next time a prompt names this thread; \`vibegraph-knowledge export\` has it all under .vibegraph/knowledge/threads/.)`;
  return { text: `${body}\n${note}`, held };
}

/** The sections held back earlier, in full, as far as `room` allows. Keys
 *  that no longer match (the contract changed) are dropped: the caller then
 *  sends the new contract as new. */
export function restOfContract(text, heldKeys, room) {
  const byKey = new Map(contractSections(text).map((s) => [s.key, s]));
  const parts = [];
  const stillHeld = [];
  let used = 0;
  for (const k of heldKeys) {
    const s = byKey.get(k);
    if (!s) continue;
    if (used + s.body.length + 2 > room) { stillHeld.push(k); continue; }
    parts.push(s.body);
    used += s.body.length + 2;
  }
  const stale = heldKeys.filter((k) => !byKey.has(k)).length;
  return { text: parts.join("\n\n"), held: stillHeld, stale };
}
