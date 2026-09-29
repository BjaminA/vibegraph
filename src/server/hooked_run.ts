// THE HOOKED RUN (2026-09-29, Ben: "modify the agent manager / orchestrator
// to use the native Claude with hooks as we proved this is the best way —
// do not delete, reroute the front end").
//
// h2h4 measured it: one plain `claude -p` session with the VibeGraph hooks
// kept every stated rule (7/7 + 7/7) at 163 s / $1.19, where the
// orchestrated run took 2,346 s / $12.08 on the same tree. So the Agent
// Manager's default is now exactly that session, launched from the GUI:
//
//   - the hooks ride `--settings` (inline JSON), so nothing is written into
//     the project's .claude/ — and when the project already installed them
//     (`init --hooks`), they are not added twice;
//   - Claude edits natively (the proven posture: no chokepoint-only tools),
//     and the hooks re-check every stated rule after each edit and block on
//     a new violation;
//   - the whole editable tree is SNAPSHOTTED first, so the run can be undone;
//   - when the session ends, the SERVER collects the evidence — every file
//     changed (a diff each), the stated checks before vs after (a violation
//     this run introduced is named), the tests that reach the changes — and
//     Claude's own summary is labelled a self-report;
//   - a person ACCEPTS (keep) or REJECTS (restore the snapshot).
//
// The orchestrated run (work_run.ts / orchestration.ts) is untouched and one
// toggle away in the panel. This module is the record, the stream parser,
// the settings builder and the tree snapshot; the spawn lives in
// hooked_runner.ts.

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { shouldSkipDir } from "./languages.ts";
import { lineDiff } from "./work_worker.ts";
import { ensurePrivateIgnore } from "./local_guard.ts";

import type { HookedRun, HookedRunChange, HookedRunEvent } from "../shared/hooked_run_wire.ts";
export type { HookedRun, HookedRunChange, HookedRunEvent } from "../shared/hooked_run_wire.ts";

export const HOOKED_RUN_FILE = path.join(".vibegraph", "hooked-run.json");
export const HOOKED_SNAP_DIR = path.join(".vibegraph", "work-snapshots", "hooked");
const MAX_EVENTS = 300;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 300 * 1024 * 1024;

// ── the record ──────────────────────────────────────────────────────────

export function loadHookedRun(root: string): HookedRun | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(root, HOOKED_RUN_FILE), "utf-8"));
    return r && r.version === 1 && typeof r.id === "string" ? r as HookedRun : null;
  } catch { return null; }
}

export function saveHookedRun(root: string, run: HookedRun): void {
  ensurePrivateIgnore(root);
  const p = path.join(root, HOOKED_RUN_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(run, null, 2) + "\n");
  fs.renameSync(`${p}.tmp`, p);
}

export function pushEvent(run: HookedRun, e: Omit<HookedRunEvent, "at">): void {
  run.events.push({ at: new Date().toISOString(), ...e });
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
}

/** A task is text a person typed: bounded, never empty. */
export function validTask(t: unknown): t is string {
  return typeof t === "string" && t.trim().length > 0 && t.length <= 20_000;
}

// ── the hooks, as Claude Code settings ──────────────────────────────────

/** The four hooks `init --hooks` installs (scripts/cli/init.mjs HOOK_SPECS),
 *  as an inline `--settings` object. `cli` is how to invoke the
 *  vibegraph-knowledge CLI; `env` pins the Python the server uses. */
export function hookSettings(root: string, cli: string[], env: Record<string, string>): object {
  const q = (s: string) => `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`;
  const cmd = (event: string) => [...Object.entries(env).map(([k, v]) => `${k}=${q(v)}`), ...cli.map(q), "hook", event, "--root", q(root), "--vg-hook"].join(" ");
  const spec = (event: string, timeout: number, matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: cmd(event), timeout }] }];
  return {
    hooks: {
      SessionStart: spec("session-start", 60),
      UserPromptSubmit: spec("prompt", 60),
      PostToolUse: spec("post-edit", 120, "Write|Edit|MultiEdit|NotebookEdit|Bash"),
      Stop: spec("stop", 180),
    },
  };
}

/** The project already carries VibeGraph's hooks (`init --hooks`): Claude
 *  Code loads them itself, and injecting them again would run each twice. */
export function projectHasHooks(root: string): boolean {
  try { return fs.readFileSync(path.join(root, ".claude", "settings.local.json"), "utf-8").includes("--vg-hook"); } catch { return false; }
}

// ── the stream ──────────────────────────────────────────────────────────

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function toolText(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  const what = i.file_path ?? i.notebook_path ?? i.command ?? i.pattern ?? i.path ?? i.url ?? "";
  return clip(`${name}${what ? ` ${String(what).replace(/\s+/g, " ")}` : ""}`);
}

/** One line of `--output-format stream-json`: the events worth showing, and
 *  the final result when this is the result line. Unknown shapes are
 *  ignored — the evidence never depends on this parse. */
export function parseStreamLine(line: string): { events: Array<Omit<HookedRunEvent, "at">>; result?: HookedRun["result"] } {
  let m: any;
  try { m = JSON.parse(line); } catch { return { events: [] }; }
  const events: Array<Omit<HookedRunEvent, "at">> = [];
  const content = Array.isArray(m?.message?.content) ? m.message.content : [];
  if (m?.type === "assistant") {
    for (const c of content) {
      if (c?.type === "tool_use") events.push({ kind: "tool", text: toolText(String(c.name ?? "tool"), c.input) });
      else if (c?.type === "text" && typeof c.text === "string" && c.text.trim()) events.push({ kind: "text", text: clip(c.text.trim(), 400) });
    }
  }
  // A hook that blocks reaches Claude as text in the next user turn.
  const blob = content.map((c: any) => (typeof c?.content === "string" ? c.content : Array.isArray(c?.content) ? c.content.map((x: any) => x?.text ?? "").join(" ") : c?.text ?? "")).join(" ");
  if ((m?.type === "user" || m?.type === "system") && /breaks a stated rule|violates a stated rule/.test(blob)) {
    const id = /\[(c\d+)[^\]]*\]/.exec(blob)?.[1];
    events.push({ kind: "blocked", text: `a VibeGraph hook blocked an edit${id ? ` (${id})` : ""} — Claude was told the rule and its reason` });
  }
  if (m?.type === "result") {
    return {
      events,
      result: {
        text: typeof m.result === "string" ? m.result : null,
        costUsd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : null,
        turns: typeof m.num_turns === "number" ? m.num_turns : null,
        durationMs: typeof m.duration_ms === "number" ? m.duration_ms : null,
        isError: m.is_error === true,
      },
    };
  }
  return { events };
}

// ── the tree snapshot ───────────────────────────────────────────────────

/** Every file a session could edit: under the root, outside dot / build /
 *  dependency directories, never a `.env*`, at most 2 MB each. */
export function editableFiles(root: string): { files: string[]; skipped: number } {
  const files: string[] = [];
  let skipped = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!shouldSkipDir(e.name)) walk(abs); continue; }
      if (!e.isFile() || e.name.startsWith(".env")) continue;
      if (fs.statSync(abs).size > MAX_FILE_BYTES) { skipped++; continue; }
      files.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(root);
  return { files: files.sort(), skipped };
}

const sha = (b: Buffer) => createHash("sha1").update(b).digest("hex");

/** Copy every editable file aside (the undo) with a hash manifest (the
 *  comparison). Refuses a tree over the size cap rather than half-copying. */
export function snapshotTree(root: string, runId: string): { ok: true; files: number; bytes: number; skipped: number } | { ok: false; error: string } {
  const { files, skipped } = editableFiles(root);
  let bytes = 0;
  for (const f of files) bytes += fs.statSync(path.join(root, f)).size;
  if (bytes > MAX_SNAPSHOT_BYTES) return { ok: false, error: `the editable tree is ${Math.round(bytes / 1e6)} MB, over the ${MAX_SNAPSHOT_BYTES / 1e6} MB snapshot cap — a run that cannot be undone is not started` };
  const dir = path.join(root, HOOKED_SNAP_DIR, runId);
  ensurePrivateIgnore(root);
  fs.rmSync(dir, { recursive: true, force: true });
  const manifest: Record<string, string> = {};
  for (const f of files) {
    const buf = fs.readFileSync(path.join(root, f));
    manifest[f] = sha(buf);
    const dest = path.join(dir, "files", f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  return { ok: true, files: files.length, bytes, skipped };
}

function readManifest(root: string, runId: string): Record<string, string> | null {
  try { return JSON.parse(fs.readFileSync(path.join(root, HOOKED_SNAP_DIR, runId, "manifest.json"), "utf-8")); } catch { return null; }
}

const isText = (b: Buffer) => !b.subarray(0, 8000).includes(0);

/** What the run changed, against the snapshot: a diff per text file. */
export function compareTree(root: string, runId: string): HookedRunChange[] {
  const manifest = readManifest(root, runId);
  if (!manifest) return [];
  const snapFile = (f: string) => path.join(root, HOOKED_SNAP_DIR, runId, "files", f);
  const now = editableFiles(root).files;
  const changes: HookedRunChange[] = [];
  const text = (b: Buffer | null) => (b && isText(b) ? b.toString("utf-8") : null);
  for (const f of now) {
    const cur = fs.readFileSync(path.join(root, f));
    if (!(f in manifest)) {
      changes.push({ file: f, status: "added", diff: text(cur) !== null ? lineDiff("", text(cur)!) : "(binary file)" });
    } else if (sha(cur) !== manifest[f]) {
      const pre = fs.readFileSync(snapFile(f));
      changes.push({ file: f, status: "modified", diff: text(pre) !== null && text(cur) !== null ? lineDiff(text(pre)!, text(cur)!) : "(binary file)" });
    }
  }
  const nowSet = new Set(now);
  for (const f of Object.keys(manifest)) if (!nowSet.has(f)) changes.push({ file: f, status: "deleted", diff: "" });
  return changes.sort((a, b) => a.file.localeCompare(b.file));
}

/** Undo: modified and deleted files get their snapshot bytes back, added
 *  files are removed. Returns the files it touched. */
export function restoreTree(root: string, runId: string, changes: HookedRunChange[]): string[] {
  const touched: string[] = [];
  for (const c of changes) {
    const abs = path.join(root, c.file);
    if (!abs.startsWith(path.resolve(root))) continue;
    if (c.status === "added") { fs.rmSync(abs, { force: true }); touched.push(c.file); continue; }
    const src = path.join(root, HOOKED_SNAP_DIR, runId, "files", c.file);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(src, abs);
    touched.push(c.file);
  }
  return touched;
}

export function dropSnapshot(root: string, runId: string): void {
  fs.rmSync(path.join(root, HOOKED_SNAP_DIR, runId), { recursive: true, force: true });
}
