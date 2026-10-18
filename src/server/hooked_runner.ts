// The hooked run's lifecycle (hooked_run.ts has the record and the pure
// parts): snapshot → spawn ONE `claude -p` with the hooks → stream its tool
// calls to the panel → collect the evidence server-side → a person accepts
// or rejects. One run at a time; a run awaiting review must be decided
// before another starts. Dependencies come in, so server.ts only routes.

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  compareTree, dropSnapshot, hookSettings, loadHookedRun, parseStreamLine, projectHasHooks, pushEvent,
  restoreTree, saveHookedRun, snapshotRoot, snapshotTree, validTask, type HookedRun,
} from "./hooked_run.ts";
import { diffEditChecks, type EditCheckRow } from "./edit_check.ts";
import { loadConstraints, type Constraint } from "./constraint_store.ts";
import { RUN_DENIED_MCP } from "./hooked_framing.ts";

/** Stated rules the run added, removed or changed (text, check or scope). */
export function ruleChanges(before: Constraint[], after: Constraint[]): string[] {
  const key = (c: Constraint) => JSON.stringify({ text: c.text, check: (c as { check?: unknown }).check ?? null, scope: c.scope, kind: c.kind });
  const was = new Map(before.map((c) => [c.id, c]));
  const now = new Map(after.map((c) => [c.id, c]));
  return [
    ...before.filter((c) => !now.has(c.id)).map((c) => `${c.id} removed — "${c.text.slice(0, 80)}"`),
    ...after.filter((c) => !was.has(c.id)).map((c) => `${c.id} added — "${c.text.slice(0, 80)}"`),
    ...after.filter((c) => was.has(c.id) && key(was.get(c.id)!) !== key(c)).map((c) => `${c.id} changed — now "${c.text.slice(0, 80)}"`),
  ];
}

export interface HookedRunDeps {
  root: string;
  /** the resolved spawn target for the worker tier. */
  target: { cmd: string; args: string[]; label: string; provider: string; env: NodeJS.ProcessEnv };
  /** how a hook invokes the vibegraph-knowledge CLI, and the Python it pins. */
  cli: string[];
  pinEnv: Record<string, string>;
  /** this server's MCP endpoint, for the on-demand tools (brief, direction…). */
  mcpUrl: string | null;
  /** the stated checks; `constraints` = evaluate these rules instead of the ones on disk */
  checkSnapshot(constraints?: Constraint[]): EditCheckRow[];
  /** re-read what changed on disk and let derived state settle. */
  settle(): Promise<void>;
  testsFor(files: string[]): string[];
  afterRestore(files: string[]): Promise<void>;
  broadcast(run: HookedRun | null): void;
  /** the run's framing, appended to Claude Code's system prompt (hooked_framing.ts) */
  framing?(): string;
  /** the dollar cap past which no further reply is sent */
  costCap?: number;
}

// the whole conversation, waiting for the person included
const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
let child: ChildProcess | null = null;
let baseline: EditCheckRow[] = [];

export function currentHookedRun(root: string): HookedRun | null {
  return loadHookedRun(root);
}

export function startHookedRun(task: unknown, deps: HookedRunDeps): { ok: true } | { ok: false; error: string } {
  if (!validTask(task)) return { ok: false, error: "describe the task (1–20,000 characters)" };
  const prev = loadHookedRun(deps.root);
  if (prev && (prev.status === "running" || prev.status === "waiting" || prev.status === "collecting")) return { ok: false, error: "a run is already in progress" };
  if (prev && prev.status === "awaiting-review") return { ok: false, error: "the last run awaits your review — accept or reject it first" };
  if (deps.target.provider !== "claude") {
    return { ok: false, error: `a hooked run needs Claude Code; the worker tier routes to ${deps.target.label} (Models panel)` };
  }
  const id = `h${Date.now().toString(36)}`;
  const snap = snapshotTree(deps.root, id);
  if (!snap.ok) return { ok: false, error: snap.error };
  const own = projectHasHooks(deps.root);
  const run: HookedRun = {
    version: 1, id, task: task.trim(), status: "running", model: deps.target.label,
    startedAt: new Date().toISOString(), hooks: own ? "project" : "injected", events: [],
    snapshot: { files: snap.files, bytes: snap.bytes, skipped: snap.skipped },
  };
  baseline = deps.checkSnapshot();
  run.costCap = deps.costCap ?? DEFAULT_COST_CAP;
  run.totals = { costUsd: 0, turns: 0, messages: 1 };
  // 2026-10-16 — a CONVERSATION, not a one-shot: stream-json in, so the person
  // can answer what Claude asks and the same session goes on (the chat's M27
  // shape); the framing says how the run works and which tools to reach for;
  // tools that spend tokens or start other agents are not offered.
  const args = [
    ...deps.target.args, "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--dangerously-skip-permissions",
    ...(own ? [] : ["--settings", JSON.stringify(hookSettings(deps.root, deps.cli, deps.pinEnv))]),
    ...(deps.mcpUrl ? ["--mcp-config", JSON.stringify({ mcpServers: { vibegraph: { type: "http", url: deps.mcpUrl } } })] : []),
    "--disallowedTools", RUN_DENIED_MCP.join(","),
    ...(deps.framing ? ["--append-system-prompt", deps.framing()] : []),
  ];
  saveHookedRun(deps.root, run);
  deps.broadcast(run);
  let p: ChildProcess;
  try {
    p = spawn(deps.target.cmd, args, { cwd: deps.root, env: { ...deps.target.env, ...deps.pinEnv }, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e: any) {
    run.status = "failed"; run.note = `could not start Claude Code: ${e?.message ?? e}`;
    dropSnapshot(deps.root, id); saveHookedRun(deps.root, run); deps.broadcast(run);
    return { ok: true };
  }
  child = p;
  let buf = "";
  let stderr = "";
  let dirty = false;
  const flush = () => { if (dirty) { dirty = false; saveHookedRun(deps.root, run); deps.broadcast(run); } };
  const tick = setInterval(flush, 500);
  const killer = setTimeout(() => { run.note = "stopped: the 2-hour run limit was reached"; p.kill("SIGTERM"); }, RUN_TIMEOUT_MS);
  p.stdout?.on("data", (d: Buffer) => {
    buf += d.toString("utf-8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const parsed = parseStreamLine(line);
      for (const e of parsed.events) pushEvent(run, e);
      if (parsed.result) {
        // a turn ended: the session waits for the person (reply, or finish)
        run.result = parsed.result;
        run.totals!.costUsd += parsed.result.costUsd ?? 0;
        run.totals!.turns += parsed.result.turns ?? 0;
        if (run.status === "running") run.status = "waiting";
      }
      if (parsed.events.length || parsed.result) dirty = true;
    }
  });
  p.stderr?.on("data", (d: Buffer) => { stderr = (stderr + d.toString("utf-8")).slice(-4000); });
  p.stdin?.on("error", () => { /* the child closed first: close() reports it */ });
  p.on("error", (e) => { pushEvent(run, { kind: "error", text: `Claude Code: ${e.message}` }); dirty = true; });
  p.on("close", (code) => {
    clearInterval(tick); clearTimeout(killer);
    child = null; live = null;
    if (code && !run.result) pushEvent(run, { kind: "error", text: `Claude Code exited ${code}${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}` });
    void collect(run, deps);
  });
  live = { run, deps, flush: () => { dirty = true; flush(); } };
  send(p, run.task);
  return { ok: true };
}

/** The live conversation: the run record and how to save it. */
let live: { run: HookedRun; deps: HookedRunDeps; flush: () => void } | null = null;
const DEFAULT_COST_CAP = Number(process.env.VG_RUN_COST_CAP ?? 10);

function send(p: ChildProcess, text: string): void {
  p.stdin?.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
}

/** The person answers or adds to the task: the same session goes on. */
export function replyHookedRun(text: unknown): { ok: true } | { ok: false; error: string } {
  if (!live || !child) return { ok: false, error: "no run is waiting for you" };
  const { run } = live;
  if (run.status !== "waiting") return { ok: false, error: "Claude is still working — wait for its turn to end, or stop it" };
  if (!validTask(text)) return { ok: false, error: "write a reply (1–20,000 characters)" };
  if ((run.totals?.costUsd ?? 0) >= (run.costCap ?? DEFAULT_COST_CAP)) return { ok: false, error: `the run has spent $${run.totals!.costUsd.toFixed(2)}, over its $${run.costCap} cap — finish it and review` };
  pushEvent(run, { kind: "you", text: text.trim().slice(0, 2000) });
  run.status = "running";
  run.totals!.messages += 1;
  send(child, text.trim());
  live.flush();
  return { ok: true };
}

/** The person is done talking: the session ends and the evidence is collected. */
export function finishHookedRun(): boolean {
  if (!live || !child || live.run.status !== "waiting") return false;
  child.stdin?.end();
  return true;
}

/** Stop a session mid-turn (or one waiting); what it changed so far goes to review. */
export function stopHookedRun(root: string): boolean {
  const run = loadHookedRun(root);
  if (!child || !run || (run.status !== "running" && run.status !== "waiting")) return false;
  run.note = "stopped by you — what it changed so far is below";
  if (live) live.run.note = run.note;
  saveHookedRun(root, run);
  child.kill("SIGTERM");
  return true;
}

async function collect(run: HookedRun, deps: HookedRunDeps): Promise<void> {
  run.status = "collecting";
  run.endedAt = new Date().toISOString();
  saveHookedRun(deps.root, run); deps.broadcast(run);
  try {
    await deps.settle();
    run.changes = compareTree(deps.root, run.id);
    // checked against the rules as they stood when the run began: a run that
    // loosened a rule must not pass by the loosened one
    const pre = fs.existsSync(path.join(snapshotRoot(deps.root, run.id), ".vibegraph", "constraints.json")) ? loadConstraints(snapshotRoot(deps.root, run.id)) : null;
    const after = deps.checkSnapshot(pre ?? undefined);
    const rulesChanged = pre ? ruleChanges(pre, loadConstraints(deps.root)) : [];
    const d = diffEditChecks(baseline, after);
    run.check = {
      rows: after.map((r) => ({ id: r.id, rule: r.rule, described: r.described, verdict: r.verdict, reason: r.reason, gates: r.gates, offenders: r.offenders ?? [] })),
      introduced: d.fresh.map((f) => `${f.row.id} · ${f.row.described}${f.added.length ? ` (${f.added.slice(0, 4).join(", ")})` : ""}`),
      inherited: d.inherited,
      fixed: d.fixed.map((f) => f.id),
      ...(rulesChanged.length ? { rulesChanged } : {}),
    };
    run.tests = deps.testsFor(run.changes.filter((c) => c.status !== "deleted").map((c) => c.file));
    run.status = run.changes.length || run.result ? "awaiting-review" : "failed";
    if (run.status === "failed") { run.note = run.note ?? "the session produced no result and changed nothing"; dropSnapshot(deps.root, run.id); }
  } catch (e: any) {
    run.status = "awaiting-review";
    run.note = `evidence could not be collected in full (${e?.message ?? e}) — the snapshot is kept, so Reject still restores`;
  }
  saveHookedRun(deps.root, run); deps.broadcast(run);
}

/** Accept keeps the changes; reject puts the snapshot back. Either way the
 *  snapshot is then dropped and the decision recorded. */
export async function decideHookedRun(accept: boolean, deps: HookedRunDeps): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = loadHookedRun(deps.root);
  if (!run || run.status !== "awaiting-review") return { ok: false, error: "no run awaits review" };
  if (!accept) {
    const touched = restoreTree(deps.root, run.id, compareTree(deps.root, run.id));
    await deps.afterRestore(touched);
    run.note = `rejected — ${touched.length} file(s) restored from the snapshot`;
  } else {
    run.note = `accepted — ${run.changes?.length ?? 0} file change(s) kept`;
  }
  run.status = accept ? "accepted" : "rejected";
  dropSnapshot(deps.root, run.id);
  saveHookedRun(deps.root, run); deps.broadcast(run);
  return { ok: true };
}
