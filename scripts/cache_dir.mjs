// Where a project's cache lives (moved out of envelope_cache.mjs, 2026-10-20):
// the setup checklist reads the hooks' fired record from here inside the
// server's CommonJS bundle, and envelope_cache.mjs pulls in the whole parse
// pipeline — whose scripts use top-level await, which CommonJS cannot carry.
// envelope_cache.mjs re-exports it, so every importer is unchanged.
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export function cacheDirFor(absRoot, env = process.env) {
  const base = env.VG_CACHE_DIR
    ?? join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "vibegraph-knowledge", "envelopes");
  return join(base, createHash("sha1").update(absRoot).digest("hex").slice(0, 16));
}
