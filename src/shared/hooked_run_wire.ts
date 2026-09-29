// The hooked run's wire shapes (src/server/hooked_run.ts), webview-safe.

export type HookedRunStatus = "running" | "collecting" | "awaiting-review" | "accepted" | "rejected" | "failed";

export interface HookedRunEvent { at: string; kind: "tool" | "text" | "blocked" | "error"; text: string }
export interface HookedRunChange { file: string; status: "added" | "modified" | "deleted"; diff: string }
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
  /** Claude's own closing text — a SELF-REPORT, never evidence. */
  result?: { text: string | null; costUsd: number | null; turns: number | null; durationMs: number | null; isError: boolean };
  changes?: HookedRunChange[];
  /** the stated checks after the run, and which violations it introduced. */
  check?: { rows: HookedRunCheckRow[]; introduced: string[]; inherited: number; fixed: string[] };
  tests?: string[];
  snapshot?: { files: number; bytes: number; skipped: number };
  note?: string;
}

/** The `hooked-run` message: the current run (null: none yet), and an error
 *  when the last request was refused. */
export interface HookedRunPayload { run: HookedRun | null; error?: string }
