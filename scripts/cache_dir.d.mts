// Types for cache_dir.mjs, which the server's TypeScript imports
// (src/server/setup_state.ts, pipeline_cache.ts, find_claude.ts).
export const PATH_VARS: string[];
export function projectCacheSetting(absRoot: string | null): string | null;
export interface VgPaths { home: string; cacheRoot: string; source: string; envelopes: string | null; server: string | null; pydeps: string; claudeVersion: string }
export function resolvePaths(absRoot?: string | null, env?: Record<string, string | undefined>): VgPaths;
export function cacheDirFor(absRoot: string, env?: Record<string, string | undefined>): string;
