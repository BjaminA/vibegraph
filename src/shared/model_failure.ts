// WHY A MODEL CALL FAILED, AND WHAT FIXES IT (2026-10-22, the root-cause
// handoff RC6: "model-call failures are flattened to 'the model returned
// nothing'"). An expired login made step after step fail with the same vague
// line, and the remedy (sign in again) was offered on some paths only. One
// table classifies a failure from what the CLI said, on stderr or in its JSON
// `is_error` result; every caller renders the kind and its remedy, the server
// and the command line alike. Webview-safe, pure.

export type ModelFailureKind = "auth" | "not-installed" | "rate-limit" | "timeout" | "bad-output" | "exit";
export interface ModelFailure { kind: ModelFailureKind; detail: string; remedy: string }
export type ModelResult = { ok: true; text: string } | ({ ok: false } & ModelFailure);

/** First match wins. The words each failure is written in by the claude CLI
 *  and the shells and APIs under it. */
const TABLE: ReadonlyArray<readonly [RegExp, ModelFailureKind]> = [
  [/oauth|failed to authenticate|authenticat|not logged in|log ?in again|\/login|invalid api key|invalid x-api-key|401\b|unauthori[sz]ed/i, "auth"],
  [/ENOENT|command not found|not found on PATH|is not recognized as|could not spawn|no such file or directory/i, "not-installed"],
  [/rate.?limit|429\b|usage limit|session limit|quota|overloaded|529\b|limit reached/i, "rate-limit"],
  [/timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT|deadline exceeded/i, "timeout"],
  [/not JSON|empty result|no result text|unexpected token|could not parse|not the JSON/i, "bad-output"],
];

const REMEDY: Record<ModelFailureKind, (cmd?: string) => string> = {
  auth: (cmd) => `log Claude Code in again: run \`claude\` in a terminal and type /login${cmd ? ` (VibeGraph runs ${cmd})` : ""}, or set CLAUDE_CODE_OAUTH_TOKEN (from \`claude setup-token\`), then try again`,
  "not-installed": () => "install Claude Code (`npm install -g @anthropic-ai/claude-code`) or point VibeGraph at it (Settings, or VG_CLAUDE_BIN), then try again",
  "rate-limit": () => "wait for the usage limit to reset (the message above says when), or route this step to another model in Settings, then try again",
  timeout: () => "try again; a long prompt can take a while on a large project",
  "bad-output": () => "try again; the reply did not come back in the shape asked for, and a second answer usually does",
  exit: () => "run the same step from the command line to see the whole output",
};

export const FAILURE_WORDS: Record<ModelFailureKind, string> = {
  auth: "Claude Code is not logged in", "not-installed": "Claude Code could not be started", "rate-limit": "the model's usage limit was reached",
  timeout: "the model call timed out", "bad-output": "the model's reply was not usable", exit: "the model call failed",
};

/** A failure's kind and remedy, from what was said about it. */
export function classifyModelFailure(detail: string, opts: { cmd?: string } = {}): ModelFailure {
  const kind = TABLE.find(([re]) => re.test(detail))?.[1] ?? "exit";
  return { kind, detail: detail.slice(0, 400), remedy: REMEDY[kind](opts.cmd) };
}

/** "Claude Code is not logged in (…what it said…). To fix: …" */
export function modelFailureText(f: ModelFailure): string {
  return `${FAILURE_WORDS[f.kind]}${f.detail ? ` (${f.detail})` : ""}. To fix: ${f.remedy}`;
}
