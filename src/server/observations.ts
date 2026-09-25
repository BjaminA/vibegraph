// PLAN-M-RUNTIME phase 3 — the trace overlay's STORE: what one consented
// run of an entry point actually dispatched to, at every call site it
// touched, persisted so it survives a restart.
//
// This is B5's Observe in batch. Observe samples one receiver on demand; a
// trace run answers the same question for a whole thread at once, so the
// dynamic dispatches a static reader cannot follow get annotated together.
//
// THE OVERLAY IS NOT THE IR, and the separation is structural, not a
// convention: observations live in `<root>/.vibegraph/observations.json`,
// never in a node, and every consumer reads them beside the IR fact rather
// than merged into it. A node's `dynamic` / `unresolved` kind is never
// touched. That is B5's rule ("one run can lie") applied to a hundred call
// sites instead of one — and at a hundred sites the temptation to promote
// is exactly a hundred times stronger.
//
// The PURE half — the wire shapes, the (file, line) join, the per-node
// lookup — lives in src/shared/observations.ts, so the tooltip and the
// server read an observation through one function instead of two that
// drift (the stack_attribution precedent). This module is the file I/O.
//
// Pure node builtins, no runtime state — every function takes the project
// root, so it unit-tests against a temp dir (the readme_store precedent).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { OBSERVATIONS_VERSION } from "../shared/observations.ts";
import type {
  JoinNode, NodeObservationRecord, ObservationStoreRecord, ObservedCalleeRecord,
  ResolvedObservation, TracedSite, TraceRunRecord,
} from "../shared/observations.ts";

export {
  OBSERVATIONS_VERSION, joinTraceToNodes, observationsForNode, runDate,
} from "../shared/observations.ts";
export type {
  JoinNode, NodeObservationRecord, ObservedCalleeRecord, ResolvedObservation, TracedSite,
};
/** Server-side aliases for the wire shapes, so call sites here read in this
 *  module's own vocabulary without a second definition existing. */
export type TraceRun = TraceRunRecord;
export type ObservationStore = ObservationStoreRecord;
export type NodeObservation = NodeObservationRecord;
export type ObservedCallee = ObservedCalleeRecord;

const EMPTY: ObservationStore = { version: OBSERVATIONS_VERSION, runs: {} };

function storePath(root: string): string {
  return join(root, ".vibegraph", "observations.json");
}

export function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

export function readObservations(root: string): ObservationStore {
  const p = storePath(root);
  if (!existsSync(p)) return { ...EMPTY, runs: {} };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.runs !== "object") {
      return { ...EMPTY, runs: {} };
    }
    // A store written by a future version is not readable as this one. Say
    // nothing rather than misread it — the overlay is optional by design.
    if (parsed.version !== OBSERVATIONS_VERSION) return { ...EMPTY, runs: {} };
    return { version: OBSERVATIONS_VERSION, runs: parsed.runs as Record<string, TraceRun> };
  } catch {
    return { ...EMPTY, runs: {} };
  }
}

/** One run per entry point: a re-run REPLACES its predecessor rather than
 *  accumulating. Two runs of the same entry point on the same inputs say the
 *  same thing, and keeping both would invite averaging them — which would
 *  turn two samples into a claim neither of them made. */
export function writeTraceRun(root: string, run: TraceRun): ObservationStore {
  const store = readObservations(root);
  // `staleFiles` is derived at projection time by whoever has the files. It
  // must never be persisted, or it would go stale itself.
  const { staleFiles: _dropped, ...persistable } = run;
  store.runs[run.entryPointId] = persistable as TraceRun;
  write(root, store);
  return store;
}

export function clearTraceRun(root: string, entryPointId: string): ObservationStore {
  const store = readObservations(root);
  if (!(entryPointId in store.runs)) return store;
  delete store.runs[entryPointId];
  write(root, store);
  return store;
}

function write(root: string, store: ObservationStore): void {
  const p = storePath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

/**
 * Stamp each run with the files whose source has MOVED since it ran.
 *
 * Computed here rather than stored because the server is the side that has
 * the files — and because a stored staleness flag would itself go stale the
 * moment someone saved. `readSource` returns null for a file it cannot
 * read, and unknown-either-side is NOT evidence of staleness: claiming a
 * staleness we cannot demonstrate is as much an invention as claiming
 * freshness.
 */
export function markStaleness(
  store: ObservationStore,
  readSource: (file: string) => string | null,
): ObservationStore {
  const current = new Map<string, string | null>();
  for (const run of Object.values(store.runs ?? {})) {
    const stale: string[] = [];
    for (const [file, stamped] of Object.entries(run.sourceHashes ?? {})) {
      if (!current.has(file)) {
        const src = readSource(file);
        current.set(file, src === null ? null : hashSource(src));
      }
      const now = current.get(file) ?? null;
      if (now && stamped && now !== stamped) stale.push(file);
    }
    run.staleFiles = stale;
  }
  return store;
}
