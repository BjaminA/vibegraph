// M-SKILL.4 — skill coverage sweep: batch-draft a grounded skill for every
// thread that lacks an authoritative one. Pure orchestration — the generator
// is INJECTED (runGenerateThreadSkill in production, a fake in tests), so the
// selection logic and failure honesty are unit-testable with no claude spawn.
//
// Floor facts that hold by construction: every draft goes through the same
// grounding-gated generator (output is ALWAYS status=draft; a human still
// ratifies each one individually), and a per-thread failure is REPORTED in
// the summary — never silently skipped — without aborting the rest.

import { isAuthoritative, type ThreadSkillResult } from "./thread_skill_store.ts";

export interface SweepTarget {
  entryPointId: string;
  /** Why this thread needs a draft: no skill / unratified draft / stale. */
  reason: "missing" | "draft" | "stale";
}

export interface SweepItemResult {
  entryPointId: string;
  ok: boolean;
  error?: string;
}

export interface SweepSummary {
  total: number;
  drafted: SweepItemResult[];
  failed: SweepItemResult[];
  /** Threads skipped because their skill is already authoritative. */
  skipped: string[];
}

/** Deterministic target selection: every entry point whose skill fails the
 *  isAuthoritative gate is a target, in entry-point order. */
export function planSweep(
  entryPointIds: string[],
  readSkill: (entryPointId: string) => ThreadSkillResult,
): { targets: SweepTarget[]; skipped: string[] } {
  const targets: SweepTarget[] = [];
  const skipped: string[] = [];
  for (const id of entryPointIds) {
    const r = readSkill(id);
    if (isAuthoritative(r)) {
      skipped.push(id);
    } else {
      const reason: SweepTarget["reason"] = !r.exists ? "missing" : r.stale ? "stale" : "draft";
      targets.push({ entryPointId: id, reason });
    }
  }
  return { targets, skipped };
}

/** Strictly SERIAL: each generation is a full `claude -p` spawn — a pool
 *  multiplies peak load for little wall-clock win on a deliberate batch
 *  action, and serial keeps progress honest and ordering deterministic.
 *  A failed item is recorded and the sweep continues. */
export async function runSweep(
  targets: SweepTarget[],
  skipped: string[],
  generate: (entryPointId: string) => Promise<{ ok: boolean; error?: string }>,
  onProgress: (done: number, total: number, item: SweepItemResult) => void,
): Promise<SweepSummary> {
  const drafted: SweepItemResult[] = [];
  const failed: SweepItemResult[] = [];
  let done = 0;
  for (const t of targets) {
    let item: SweepItemResult;
    try {
      const r = await generate(t.entryPointId);
      item = r.ok
        ? { entryPointId: t.entryPointId, ok: true }
        : { entryPointId: t.entryPointId, ok: false, error: r.error ?? "generation failed" };
    } catch (err: any) {
      item = { entryPointId: t.entryPointId, ok: false, error: err?.message ?? String(err) };
    }
    (item.ok ? drafted : failed).push(item);
    done += 1;
    onProgress(done, targets.length, item);
  }
  return { total: targets.length, drafted, failed, skipped };
}
