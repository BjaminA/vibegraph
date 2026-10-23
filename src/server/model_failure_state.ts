// The last model call's failure, typed (2026-10-22, the root-cause handoff RC6).
// The server's runner (_runReadmeLlm) records why a call returned nothing, once,
// and every caller that reports it reads it here, so each says the same kind
// and remedy instead of "the model returned nothing" (src/shared/model_failure.ts).
// Cleared by a call that succeeds.

import { classifyModelFailure, modelFailureText, type ModelFailure } from "../shared/model_failure.ts";

let last: ModelFailure | null = null;

export function recordModelFailure(detail: string | null, cmd?: string): void {
  last = detail ? classifyModelFailure(detail, { cmd }) : null;
}

export function lastModelFailure(): ModelFailure | null {
  return last;
}

/** The message a caller returns when the model gave nothing: why, and what fixes it. */
export function modelNothingText(prefix = "the model returned nothing"): string {
  return last ? `${prefix}: ${modelFailureText(last)}` : prefix;
}
