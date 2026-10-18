// The hooked run's wire shapes (src/server/hooked_run.ts), webview-safe.

/** `waiting` (2026-10-16): Claude ended a turn and the session waits for the
 *  person — a reply continues it, Finish collects the evidence. */
export type HookedRunStatus = "running" | "waiting" | "collecting" | "awaiting-review" | "accepted" | "rejected" | "failed";

/** `you`: the person's message; `question`: a line Claude wrote as `QUESTION: …` */
export interface HookedRunEvent { at: string; kind: "tool" | "text" | "blocked" | "error" | "you" | "question"; text: string }
/** `stated`: a file under .vibegraph/ — what the project states (rules, plan, architecture, skills) */
export interface HookedRunChange { file: string; status: "added" | "modified" | "deleted"; diff: string; stated?: boolean }
export interface HookedRunCheckRow { id: string; rule: string; described: string; verdict: string; reason: string; gates: boolean; offenders: string[] }

export interface HookedRun {
  version: 1;
  id: string;
  task: string;
  status: HookedRunStatus;
  model: string;
  startedAt: string;
  endedAt?: string;
  /** how the hooks reached the session: injected here, or the project's own. */
  hooks: "injected" | "project";
  events: HookedRunEvent[];
  /** across every turn of the conversation (the last turn's figures are in `result`) */
  totals?: { costUsd: number; turns: number; messages: number };
  /** the dollar cap: past it no further reply is sent (finish and review) */
  costCap?: number;
  /** Claude's own closing text — a SELF-REPORT, never evidence. */
  result?: { text: string | null; costUsd: number | null; turns: number | null; durationMs: number | null; isError: boolean };
  changes?: HookedRunChange[];
  /** the stated checks after the run, and which violations it introduced. */
  /** `rulesChanged`: stated rules the run added, removed or changed — the
   *  checks above are against the rules as they stood when it began */
  check?: { rows: HookedRunCheckRow[]; introduced: string[]; inherited: number; fixed: string[]; rulesChanged?: string[] };
  tests?: string[];
  snapshot?: { files: number; bytes: number; skipped: number };
  note?: string;
}

/** The `hooked-run` message: the current run (null: none yet), and an error
 *  when the last request was refused. */
/** What a run will be told about the project (src/server/hooked_framing.ts) —
 *  shown before it starts, so the person sees what Claude will know. */
export interface HookedRunFacts { objective: string | null; rules: number; waiting: number; openQuestions: Array<{ id: string; text: string }>; direction: string[]; projectDirection?: number }

export interface HookedRunPayload { run: HookedRun | null; error?: string; facts?: HookedRunFacts }
