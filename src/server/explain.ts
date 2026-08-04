// C2 (PLAN-v6) — explain-this-node: a LABELLED inference about an unresolved or
// external reference (e.g. `F.relu`, `torch.stack`, `jsonify`). The governing
// rule binds it: this is Claude's interpretation, ranked BELOW the honest IR
// fact, and it NEVER overwrites the node's `unresolved`/`external` state.
//
// The honesty-critical pieces — the attribution label and the prompt framing
// that forces the model to hedge and not assert resolution — live here, pure
// and unit-testable. server.ts owns the claude -p call + the cache.

/** The attribution that travels with every explanation (X1). */
export const EXPLAIN_ATTRIBUTION =
  "Claude's interpretation — an inference about an unresolved/external reference, NOT a resolved fact. Ranks below the honest IR state; it does not change the node's unresolved/external classification.";

/** Prompt the model to INFER, hedged, never asserting resolution. */
export function explainPrompt(source: string): string {
  return [
    "The Python code below contains an UNRESOLVED or EXTERNAL reference — a call VibeGraph could not",
    "resolve to project source (a third-party library, or a runtime-dynamic target). In 1-2 sentences,",
    "infer what it most LIKELY does. This is an INTERPRETATION, not a resolved fact — hedge appropriately",
    '("likely", "appears to") and do NOT claim certainty. Output ONLY the inference, no preamble.',
    "",
    "```python",
    source,
    "```",
  ].join("\n");
}

export interface NodeExplanation {
  nodeId: string;
  interpretation: string | null;
  attribution: string;
  cached: boolean;
  error?: string;
}
