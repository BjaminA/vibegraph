// EVERY PATH VIBEGRAPH KEEPS OUTSIDE A PROJECT, from one resolver (2026-10-22,
// the root-cause handoff RC7: "cache and hook paths have several resolvers").
// The envelope cache, the server's pipeline cache, the Python dependencies and
// the Claude version check each had their own precedence, and one hard-coded
// `~/.cache`; keeping the cache inside a project meant editing every hook by
// hand, and the Claude check still wrote to `~/.cache`. One precedence now:
//
//   1. the project's `.vibegraph/config.json` `cacheDir` (relative to the project)
//   2. VG_CACHE_DIR
//   3. $XDG_CACHE_HOME/vibegraph-knowledge
//   4. ~/.cache/vibegraph-knowledge
//
// A directory named by 1 or 2 is VibeGraph's outright, and keeps the layout
// VG_CACHE_DIR always had (a project's envelopes directly under it), so no
// existing cache, hook record or lesson moves. VIBEGRAPH_KNOWLEDGE_HOME still
// names the Python dependencies' home when set.
//
// Plain JS on purpose: the server's CommonJS bundle reads it (the setup
// checklist reads the hooks' fired record), and envelope_cache.mjs pulls in the
// whole parse pipeline, whose top-level await CommonJS cannot carry.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The variables a path depends on, which an installed hook must carry. */
export const PATH_VARS = ["VG_CACHE_DIR", "XDG_CACHE_HOME", "VIBEGRAPH_KNOWLEDGE_HOME"];

/** The project's own setting, `.vibegraph/config.json` `cacheDir`, resolved; or null. */
export function projectCacheSetting(absRoot) {
  if (!absRoot) return null;
  try {
    const c = JSON.parse(readFileSync(join(absRoot, ".vibegraph", "config.json"), "utf-8"));
    return typeof c?.cacheDir === "string" && c.cacheDir.trim() ? resolve(absRoot, c.cacheDir.trim()) : null;
  } catch { return null; }
}

/**
 * @param {string | null} absRoot the project (null: the paths shared by every project)
 * @returns {{ home: string, cacheRoot: string, source: string, envelopes: string | null, server: string | null, pydeps: string, claudeVersion: string }}
 */
export function resolvePaths(absRoot = null, env = process.env) {
  const home = homedir();
  const configured = projectCacheSetting(absRoot);
  const own = configured ?? env.VG_CACHE_DIR ?? null;
  const source = configured ? ".vibegraph/config.json cacheDir" : env.VG_CACHE_DIR ? "VG_CACHE_DIR" : env.XDG_CACHE_HOME ? "XDG_CACHE_HOME" : "the default";
  const cacheRoot = own ?? join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "vibegraph-knowledge");
  const key = absRoot ? createHash("sha1").update(absRoot).digest("hex").slice(0, 16) : null;
  return {
    home, cacheRoot, source,
    envelopes: key ? (own ? join(own, key) : join(cacheRoot, "envelopes", key)) : null,
    server: key ? join(cacheRoot, "server", key) : null,
    pydeps: env.VIBEGRAPH_KNOWLEDGE_HOME ?? cacheRoot,
    claudeVersion: join(cacheRoot, "claude-version.json"),
  };
}

/** Where a project's envelope cache, hook record and lessons live. */
export function cacheDirFor(absRoot, env = process.env) {
  return resolvePaths(absRoot, env).envelopes;
}
