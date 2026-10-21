// Which threads a rule's scope reaches — the ONE predicate (moved out of
// constraint_store.ts, 2026-10-19, so the Rules panel's scope picker can
// preview "reaches N threads" with the rule the server routes by; a preview
// computed any other way would be a second opinion about the same scope).
// Webview-safe: no I/O.

export interface RuleScope { all?: boolean; entryPointIds?: string[]; files?: string[]; stack?: string[] }

export interface RoutableThread {
  entryPointId: string | null;
  filesReached: string[];
  /** M-STACK.2 — the tool names this thread's files use (the stack index's
   *  byThread slice). Absent = no stack index; stack scopes then match
   *  nothing, which is honest: no facts, no routing. */
  stack?: string[];
}

/** A scope reaches a thread when it names the thread, a file the thread
 *  reaches (a path ending "/" is a folder), a TOOL the thread's stack uses,
 *  or everything. */
export function scopeReaches(scope: RuleScope, thread: RoutableThread): boolean {
  if (scope.all) return true;
  if (thread.entryPointId && scope.entryPointIds?.includes(thread.entryPointId)) return true;
  for (const f of scope.files ?? []) {
    if (f.endsWith("/") ? thread.filesReached.some((r) => r.startsWith(f)) : thread.filesReached.includes(f)) return true;
  }
  // The dynamic half: a stack scope follows the FACTS, so a file added
  // tomorrow that imports the tool is inside this scope with no edit.
  for (const t of scope.stack ?? []) {
    if (thread.stack?.includes(t)) return true;
  }
  return false;
}
