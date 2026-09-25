// M-LANG5b (PLAN-M-LANG.md) — the Node-side diff-confinement check,
// shared by every Node rewriter (rewrite_bash.mjs, rewrite_jsts.mjs).
// Extracted from rewrite_bash at its second consumer: this is the
// THIRD implementation of one contract (cst_rewrite.py's
// _verify_diff_confined is the first), and all three are pinned to
// the SAME vectors (test/fixtures/rewrite_confinement/vectors.json) —
// none of them can drift. NEVER weakened (vibegraph-cst-ops).
//
// Semantics, line-for-line with the Python original: lines outside the
// target's 1-indexed inclusive pre-edit span must be byte-identical
// modulo right-strip; the check anchors on the unchanged head and tail
// so in-span growth/shrink passes and any out-of-span mutation throws
// OpError("diff_confinement_failed") with the offending diff surfaced
// (Guard 1: never swallowed).

export class OpError extends Error {
  constructor(kind, msg, diff) {
    super(msg);
    this.kind = kind;
    this.diff = diff;
  }
}

export function verifyDiffConfined(pre, post, targetSpan, op) {
  const preLines = pre.split("\n");
  const postLines = post.split("\n");
  const [line0, line1] = targetSpan; // 1-indexed inclusive

  const headPre = preLines.slice(0, line0 - 1).map((l) => l.trimEnd());
  const tailPre = preLines.slice(line1).map((l) => l.trimEnd());

  const headPost = postLines.slice(0, headPre.length).map((l) => l.trimEnd());
  if (JSON.stringify(headPost) !== JSON.stringify(headPre)) {
    throw new OpError(
      "diff_confinement_failed",
      `${op}: diff escapes target span (head changed)`,
      simpleDiff(headPre, headPost),
    );
  }
  if (tailPre.length > 0) {
    const tailPost = postLines.slice(-tailPre.length).map((l) => l.trimEnd());
    if (JSON.stringify(tailPost) !== JSON.stringify(tailPre)) {
      throw new OpError(
        "diff_confinement_failed",
        `${op}: diff escapes target span (tail changed)`,
        simpleDiff(tailPre, tailPost),
      );
    }
  }
}

// Minimal head/tail-anchored line diff for error payloads and the
// whole-scope ops' confirmation extras.
export function simpleDiff(preLines, postLines) {
  let h = 0;
  while (h < preLines.length && h < postLines.length && preLines[h] === postLines[h]) h++;
  let t = 0;
  while (
    t < preLines.length - h && t < postLines.length - h
    && preLines[preLines.length - 1 - t] === postLines[postLines.length - 1 - t]
  ) t++;
  const out = [];
  for (const l of preLines.slice(h, preLines.length - t)) out.push(`-${l}`);
  for (const l of postLines.slice(h, postLines.length - t)) out.push(`+${l}`);
  return out.slice(0, 40).join("\n");
}

// Splice-position helpers shared by the span-splice rewriters.
export function lineStartIndex(source, byteIdx) {
  const nl = source.lastIndexOf("\n", byteIdx - 1);
  return nl === -1 ? 0 : nl + 1;
}

export function lineEndIndex(source, byteIdx) {
  const nl = source.indexOf("\n", byteIdx);
  return nl === -1 ? source.length : nl;
}

export function indentAt(source, byteIdx) {
  const start = lineStartIndex(source, byteIdx);
  const line = source.slice(start, lineEndIndex(source, start));
  return line.match(/^[ \t]*/)[0];
}

export function reindent(text, indent) {
  return text
    .split("\n")
    .map((l) => (l.trim() ? indent + l : l))
    .join("\n");
}
