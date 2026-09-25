// Entry points that share a label get a suffix that tells them apart.
//
// On a private production codebase twelve Python CLIs are all labelled `main` and two
// `naming.ts` scripts share their file name, so the Threads list read
// "main, main, main, …". A label that is unique is left alone; a repeated
// one gains the SHORTEST piece of its file path that is unique within its
// group: the file name (`main · compare.py`) when that differs, otherwise
// as many parent directories as it takes (`naming.ts · credits/server` vs
// `naming.ts · userDb`). When two entries share the label AND the file, the
// IR node id is the only thing left, so it is used.
//
// Pure and webview-safe: the side panel and the System view read one rule.

export interface LabelledEntry { id: string; label: string; file: string; irNodeId?: string | null }

/** id → suffix, for entries whose label repeats. Entries not in the map need none. */
export function entryLabelSuffixes(entries: LabelledEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  const byLabel = new Map<string, LabelledEntry[]>();
  for (const e of entries) byLabel.set(e.label, [...(byLabel.get(e.label) ?? []), e]);
  for (const [label, group] of byLabel) {
    if (group.length < 2) continue;
    const parts = group.map((e) => e.file.split("/").filter(Boolean));
    const maxDepth = Math.max(...parts.map((p) => p.length));
    // Directory tails only, when the file name IS the label (saying it twice tells nothing).
    const dirsOnly = group.every((e, i) => parts[i][parts[i].length - 1] === label);
    let chosen: string[] | null = null;
    for (let k = 1; k <= maxDepth; k++) {
      const tails = parts.map((p) => (dirsOnly ? p.slice(0, -1) : p).slice(-k).join("/"));
      if (tails.every((t) => t) && new Set(tails).size === tails.length) { chosen = tails; break; }
    }
    group.forEach((e, i) => {
      const tail = chosen?.[i] ?? `${e.file}${e.irNodeId ? ` ${e.irNodeId}` : ""}`;
      out.set(e.id, tail);
    });
  }
  return out;
}
