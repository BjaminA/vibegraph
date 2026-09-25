// What a run COST, in dollars, from the only source that knows: the
// `total_cost_usd` the headless CLI puts in its own result envelope.
//
// Why this exists. Head-to-head #3 (reviews/h2h3/REPORT.md, 2026-09-21)
// could print plain Claude's cost for every arm and had to leave the
// orchestrated arm's column as "not recorded" — both spawn sites parsed
// the envelope for `.result` and dropped every other field, so a run that
// spent nine model spawns could say WHICH models ran and never how much.
// A comparison that cannot price one side is not a comparison.
//
// Two honesty rules, both from the M-PROVIDER shape:
//   * a spawn that reports NO cost is counted as a spawn with unknown
//     cost, never as a spawn that cost nothing. A local Ollama route
//     genuinely costs no dollars and a failed spawn genuinely reported
//     nothing, and those are different facts — `unpriced` keeps them
//     apart from a true zero.
//   * the total is what the CLI said, summed. It is not re-derived from
//     tokens, and it is not an estimate.

/** One kind of spawn, for the per-kind breakdown a run summary renders. */
export type SpendKind = "brief" | "worker" | "review" | "gen";

export interface SpendEntry {
  kind: SpendKind;
  /** Dollars the CLI reported, or null when it reported none. */
  usd: number | null;
  at: string;
}

export interface Spend {
  /** Summed `total_cost_usd` across every spawn that reported one. */
  usd: number;
  /** Spawns counted, priced or not. */
  spawns: number;
  /** Spawns that reported no cost (a local route, or a failure). */
  unpriced: number;
  byKind: Record<string, { usd: number; spawns: number; unpriced: number }>;
}

export function emptySpend(): Spend {
  return { usd: 0, spawns: 0, unpriced: 0, byKind: {} };
}

/**
 * The `total_cost_usd` of a parsed CLI envelope, or null when it carries
 * none. Anything that is not a finite non-negative number is null: a
 * malformed envelope must not silently add to a total someone will quote.
 */
export function costOf(envelope: unknown): number | null {
  if (!envelope || typeof envelope !== "object") return null;
  const raw = (envelope as { total_cost_usd?: unknown }).total_cost_usd;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/** Add one spawn to a ledger. Pure: returns a new Spend. */
export function addSpend(spend: Spend, kind: SpendKind, usd: number | null): Spend {
  const bucket = spend.byKind[kind] ?? { usd: 0, spawns: 0, unpriced: 0 };
  return {
    usd: spend.usd + (usd ?? 0),
    spawns: spend.spawns + 1,
    unpriced: spend.unpriced + (usd === null ? 1 : 0),
    byKind: {
      ...spend.byKind,
      [kind]: {
        usd: bucket.usd + (usd ?? 0),
        spawns: bucket.spawns + 1,
        unpriced: bucket.unpriced + (usd === null ? 1 : 0),
      },
    },
  };
}

/**
 * The sentence a run summary carries. Says the total, the spawn count, and
 * — when any spawn reported nothing — that the total is a floor rather
 * than the whole bill.
 */
export function spendSentence(spend: Spend | null | undefined): string {
  if (!spend || spend.spawns === 0) return "";
  const kinds = Object.entries(spend.byKind)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${v.spawns}×$${v.usd.toFixed(2)}`)
    .join(", ");
  const floor = spend.unpriced
    ? ` ${spend.unpriced} spawn(s) reported no cost (a local route, or a spawn that failed), so this is a floor, not the whole bill.`
    : "";
  return ` Cost: $${spend.usd.toFixed(2)} over ${spend.spawns} model spawn(s) — ${kinds}.${floor}`;
}
