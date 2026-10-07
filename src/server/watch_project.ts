// WATCHING A PROJECT THAT MAY NOT WANT TO BE WATCHED (2026-10-07, field
// report: Windows Node on a `\\wsl.localhost\…` project). The recursive
// fs.watch failed on WSL's file share, the per-file fallback had no guard,
// one EISDIR threw, and the server exited before it listened — the page sat
// on the loading screen for ever. Watching is a convenience (live reload);
// it must never stop the server.
//
// The ladder, each rung only when the one above failed:
//   recursive   one fs.watch over the tree (Linux, macOS, Windows on a local disk)
//   per-file    one fs.watch a source file, each guarded; a file that cannot
//               be watched is skipped, not fatal
//   polling     fs.watchFile by modification time (a network share, or every
//               per-file watch failed), up to POLL_CAP files
//   off         nothing could be watched: the server serves, live reload is off
// The mode and the reason are returned so the banner can say them.

import * as fs from "fs";
import * as path from "path";

export type WatchMode = "recursive" | "per-file" | "polling" | "off";
export interface WatchResult { mode: WatchMode; note: string | null }

export const POLL_CAP = 3000;
const POLL_MS = 2000;

/** A Windows path onto WSL's file share (`\\wsl.localhost\Distro\…`, `\\wsl$\…`). */
export function isWslShare(p: string, platform: string = process.platform): boolean {
  return platform === "win32" && /^\\\\wsl(\.localhost|\$)\\/i.test(p);
}

export const WSL_SHARE_HINT =
  "this project is on WSL's file share and Windows Node cannot watch it there — live reload polls instead. " +
  "For instant reload, run `vibegraph-knowledge view` from inside WSL.";

interface Watchers {
  watch: (p: string, opts: fs.WatchOptions, cb: (ev: string, f: string | null) => void) => fs.FSWatcher;
  watchFile: (p: string, opts: { interval: number }, cb: (cur: fs.Stats, prev: fs.Stats) => void) => void;
}
const NODE_FS: Watchers = {
  watch: (p, opts, cb) => fs.watch(p, opts, (ev, f) => cb(ev, f == null ? null : String(f))),
  watchFile: (p, opts, cb) => fs.watchFile(p, opts, cb),
};

/** Watch `root`; `onChange(rel)` gets a project-relative POSIX path. */
export function watchProject(
  root: string,
  opts: {
    onChange: (rel: string) => void;
    files: () => string[];
    log?: (m: string) => void;
    platform?: string;
    fsImpl?: Watchers;
  },
): WatchResult {
  const log = opts.log ?? ((m: string) => console.warn(`  [Watch] ${m}`));
  const fsx = opts.fsImpl ?? NODE_FS;
  const rel = (abs: string) => path.relative(root, abs).split(path.sep).join("/");
  const guard = (w: fs.FSWatcher) => w.on("error", (err) => log(`watcher error (live reload may stop) — ${(err as Error).message}`));
  const share = isWslShare(root, opts.platform);

  // 1. recursive — not on WSL's share, where it fails or reports nothing
  if (!share) {
    try {
      guard(fsx.watch(root, { recursive: true }, (_, f) => { if (f) opts.onChange(f.split(path.sep).join("/")); }));
      return { mode: "recursive", note: null };
    } catch (e: any) {
      log(`recursive watch unavailable (${e?.code ?? e?.message ?? e}); watching files one by one`);
    }
  }
  let files: string[] = [];
  try { files = opts.files(); } catch (e: any) { log(`could not list the project's files (${e?.message ?? e})`); }

  // 2. per-file, every watch guarded
  if (!share) {
    let ok = 0, failed = 0;
    for (const f of files) {
      try {
        guard(fsx.watch(f, {}, () => opts.onChange(rel(f))));
        ok++;
      } catch { failed++; }
    }
    if (ok > 0) {
      return { mode: "per-file", note: failed ? `${failed} of ${files.length} files could not be watched` : null };
    }
    if (files.length) log(`no file could be watched (${failed} failed); polling instead`);
  }

  // 3. polling by modification time
  const polled = files.slice(0, POLL_CAP);
  let polling = 0;
  for (const f of polled) {
    try {
      fsx.watchFile(f, { interval: POLL_MS }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) opts.onChange(rel(f)); });
      polling++;
    } catch { /* this file is not reloaded live */ }
  }
  if (polling > 0) {
    const capped = files.length > POLL_CAP ? `; only the first ${POLL_CAP} of ${files.length} files` : "";
    return { mode: "polling", note: `${share ? WSL_SHARE_HINT : "polling for changes every 2 s"}${capped}` };
  }
  return { mode: "off", note: `live reload is off — nothing in ${root} could be watched; restart the viewer to see changes${share ? `. ${WSL_SHARE_HINT}` : ""}` };
}
