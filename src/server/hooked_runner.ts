// The hooked run's lifecycle (hooked_run.ts has the record and the pure
// parts): snapshot → spawn ONE `claude -p` with the hooks → stream its tool
// calls to the panel → collect the evidence server-side → a person accepts
// or rejects. One run at a time; a run awaiting review must be decided
// before another starts. Dependencies come in, so server.ts only routes.

import { spawn, type ChildProcess } from "child_process";
import {
  compareTree, dropSnapshot, hookSettings, loadHookedRun, parseStreamLine, projectHasHooks, pushEvent,
  restoreTree, saveHookedRun, snapshotTree, validTask, type HookedRun,
} from "./hooked_run.ts";
import { diffEditChecks, type EditCheckRow } from "./edit_check.ts";

export interface HookedRunDeps {
  root: string;
  /** the resolved spawn target for the worker tier. */
  target: { cmd: string; args: string[]; label: string; provider: string; env: NodeJS.ProcessEnv };
  /** how a hook invokes the vibegraph-knowledge CLI, and the Python it pins. */
  cli: string[];
  pinEnv: Record<string, string>;
  /** this server's MCP endpoint, for the on-demand tools (brief, direction…). */
  mcpUrl: string | null;
  checkSnapshot(): EditCheckRow[];
  /** re-read what changed on disk and let derived state settle. */
  settle(): Promise<void>;
  testsFor(files: string[]): string[];
  afterRestore(files: string[]): Promise<void>;
  broadcast(run: HookedRun | null): void;
}

const RUN_TIMEOUT_MS = 60 * 60 * 1000;
let child: ChildProcess | null = null;
let baseline: EditCheckRow[] = [];

export function currentHookedRun(root: string): HookedRun | null {
  return loadHookedRun(root);
}

export function startHookedRun(task: unknown, deps: HookedRunDeps): { ok: true } | { ok: false; error: string } {
  if (!validTask(task)) return { ok: false, error: "describe the task (1–20,000 characters)" };
  const prev = loadHookedRun(deps.root);
  if (prev && (prev.status === "running" || prev.status === "collecting")) return { ok: false, error: "a run is already in progress" };
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
  const args = [
    ...deps.target.args, "-p", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions",
    ...(own ? [] : ["--settings", JSON.stringify(hookSettings(deps.root, deps.cli, deps.pinEnv))]),
    ...(deps.mcpUrl ? ["--mcp-config", JSON.stringify({ mcpServers: { vibegraph: { type: "http", url: deps.mcpUrl } } })] : []),
    run.task,
  ];
  saveHookedRun(deps.root, run);
  deps.broadcast(run);
  let p: ChildProcess;
  try {
    p = spawn(deps.target.cmd, args, { cwd: deps.root, env: { ...deps.target.env, ...deps.pinEnv }, stdio: ["ignore", "pipe", "pipe"] });
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
  const killer = setTimeout(() => { run.note = "stopped: the 60-minute run limit was reached"; p.kill("SIGTERM"); }, RUN_TIMEOUT_MS);
  p.stdout?.on("data", (d: Buffer) => {
    buf += d.toString("utf-8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const parsed = parseStreamLine(line);
      for (const e of parsed.events) pushEvent(run, e);
      if (parsed.result) run.result = parsed.result;
      if (parsed.events.length || parsed.result) dirty = true;
    }
  });
  p.stderr?.on("data", (d: Buffer) => { stderr = (stderr + d.toString("utf-8")).slice(-4000); });
  p.on("error", (e) => { pushEvent(run, { kind: "error", text: `Claude Code: ${e.message}` }); dirty = true; });
  p.on("close", (code) => {
    clearInterval(tick); clearTimeout(killer);
    child = null;
    if (code && !run.result) pushEvent(run, { kind: "error", text: `Claude Code exited ${code}${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}` });
    void collect(run, deps);
  });
  return { ok: true };
}

/** Stop a running session; what it changed so far goes to review. */
export function stopHookedRun(root: string): boolean {
  const run = loadHookedRun(root);
  if (!child || !run || run.status !== "running") return false;
  run.note = "stopped by you — what it changed so far is below";
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
    const after = deps.checkSnapshot();
    const d = diffEditChecks(baseline, after);
    run.check = {
      rows: after.map((r) => ({ id: r.id, rule: r.rule, described: r.described, verdict: r.verdict, reason: r.reason, gates: r.gates, offenders: r.offenders ?? [] })),
      introduced: d.fresh.map((f) => `${f.row.id} · ${f.row.described}${f.added.length ? ` (${f.added.slice(0, 4).join(", ")})` : ""}`),
      inherited: d.inherited,
      fixed: d.fixed.map((f) => f.id),
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
