// One colour per plan-vs-code verdict, shared by the Plan panel and the
// architecture map's planned threads (2026-10-01), so the two never disagree.
import type { PlanVerdict } from "../shared/plan_types";

export const VERDICT_TONE: Record<PlanVerdict, string> = {
  realised: "var(--accent-thread)", pass: "var(--accent-thread)",
  drifted: "var(--accent-warning)", unverifiable: "var(--accent-warning)", unverified: "var(--text-muted)",
  "not-built": "var(--text-muted)", unanchored: "var(--text-muted)", prose: "var(--text-muted)",
  violated: "var(--accent-error)",
  orphaned: "var(--accent-warning)",
};

export const verdictTone = (v: string | undefined): string => (v && (VERDICT_TONE as Record<string, string>)[v]) || "var(--text-muted)";
