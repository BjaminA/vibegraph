// PLAN-v7 Stage 5 — the per-item status glyph, one icon per BuildItemStatus.
// A leaf shared by RoadmapPanel (rows) and StageDetailDialog (M-GF3.3 header
// + navigation chips) — extracted so the dialog doesn't import the panel.

import React from "react";
import {
  CircleDashed, CircleDot, CircleCheck, CircleX, CircleMinus, Loader2,
} from "lucide-react";
import type { BuildPlanItem } from "./types";

export function StatusGlyph({ status, size = 16 }: { status: BuildPlanItem["status"]; size?: number }) {
  const common = { size, strokeWidth: 1.5 } as const;
  switch (status) {
    case "pending": return <CircleDashed {...common} color="var(--text-muted)" />;
    case "drafting": return <Loader2 {...common} color="var(--accent-chat)" className="vg-spin" />;
    case "gated": return <CircleDot {...common} color="var(--proposed-accent)" />;
    case "built": return <CircleCheck {...common} color="var(--accent-thread)" />;
    case "failed": return <CircleX {...common} color="var(--accent-error)" />;
    case "skipped": return <CircleMinus {...common} color="var(--accent-warning)" />;
  }
}
