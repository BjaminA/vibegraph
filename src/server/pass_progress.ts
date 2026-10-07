// What the first full pass is doing, in words for the boot screen (2026-10-07,
// field report: the first `view` of a 248-file project ran for over two
// minutes behind a spinner that said nothing). One line per phase, with the
// counts that explain the wait.

export const LARGE_TREE = 200;

export function phaseTexter(files: number, toParse: number, entryPoints: () => number): (phase: string) => string {
  const why = files >= LARGE_TREE ? ` — a large tree (${files} source files), so this takes a while` : "";
  return (phase) => {
    switch (phase) {
      case "walk": return "finding the source files…";
      case "parse": return `parsing ${toParse} of ${files} files${toParse < files ? ` (${files - toParse} unchanged, from the cache)` : ""}${why}`;
      case "link": return `linking calls across ${files} files…`;
      case "discover": return "finding the entry points…";
      case "threads": return `tracing threads from ${entryPoints()} entry points${why || "…"}`;
      case "system": case "stack": case "crossings": case "map": return "building the system map…";
      case "deps": return "checking dependencies…";
      case "send": return "drawing…";
      default: return `${phase}…`;
    }
  };
}

export const DEFAULT_PHASE_TEXT = phaseTexter(0, 0, () => 0);
