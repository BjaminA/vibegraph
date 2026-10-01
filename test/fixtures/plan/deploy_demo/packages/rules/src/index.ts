// Pure scoring logic: a library, run by more than one deployable.

/** Score an input. */
export function score(x: number): number {
  return x * 2;
}

/** Classify an input by its score. */
export function classify(x: number): "high" | "low" {
  return score(x) > 10 ? "high" : "low";
}
