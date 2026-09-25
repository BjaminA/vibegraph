/**
 * Re-linking the live parse map is a read-modify-write across an await:
 * the linker is handed the map, runs as a subprocess, and its output
 * replaces the map. Anything that patched an entry meanwhile — a worker's
 * chokepoint edit, a rejected packet's snapshot restore, an evidence
 * re-parse, a created file — would be reverted in memory by that
 * replacement while its bytes stayed on disk. That is not hypothetical:
 * with lanes, a rejected packet's restore schedules a derived refresh
 * whose linker starts on the clean map; the next packet's worker edits
 * the same file while it is in flight; the refresh's output then hid the
 * edit from every reader of the map (the stack pre-check read an empty IR
 * delta for a file whose text diff showed `import requests`, and
 * approved it). `parseAllFiles` has guarded its own full pass this way
 * since M26.1; this is the same rule for every other re-link.
 *
 * The merge is pure: the caller says which files changed since the link
 * started (a per-file generation counter). For each file in the CURRENT
 * map, the linked entry is taken only when the file did not change
 * meanwhile; otherwise the current (newer, possibly unlinked) entry wins —
 * the follow-up refresh the patch scheduled re-links it. Files absent from
 * the current map are dropped even if the linker still knew them (deleted
 * meanwhile); files the current map gained are kept (created meanwhile).
 */
export function mergeRelinked<T>(
  current: Record<string, T>,
  linked: Record<string, T>,
  changedSince: (file: string) => boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const f of Object.keys(current)) {
    out[f] = !changedSince(f) && linked[f] !== undefined ? linked[f] : current[f];
  }
  return out;
}

/** Per-file generation counter behind `mergeRelinked`: bump on every
 *  in-memory patch, snapshot before a link, compare after. */
export class ParseGenerations {
  private gen = new Map<string, number>();
  touch(file: string): void {
    this.gen.set(file, (this.gen.get(file) ?? 0) + 1);
  }
  snapshot(): Map<string, number> {
    return new Map(this.gen);
  }
  changedSince(snap: Map<string, number>): (file: string) => boolean {
    return (file) => (this.gen.get(file) ?? 0) !== (snap.get(file) ?? 0);
  }
}
