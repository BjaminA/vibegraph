// Missing-project-deps banner (NEXT-ACTIONS §2 — project-env awareness).
//
// The runtime resolves external callables by importing them from its
// own .pydeps PYTHONPATH, so an analyzed project's third-party deps
// must be installed there. Nothing used to surface the gap — the only
// symptom was silently-unresolved tooltips. Same presentational
// pattern as KeyBanner (fixed dismissible top chip, --accent-warning);
// parent owns dismiss state. `top` lets it stack under KeyBanner when
// both are shown.

import React from "react";
import { PackageX, X } from "lucide-react";

interface Props {
  missing: { module: string; files: string[] }[];
  dismissed: boolean;
  onDismiss: () => void;
  /** Unused since the banner became a toolbar chip; kept so callers compile. */
  top?: string;
}

export function DepsBanner({ missing, dismissed, onDismiss }: Props) {
  if (dismissed || missing.length === 0) return null;
  const mods = missing.map((m) => m.module);
  const shown = mods.slice(0, 4).join(", ") + (mods.length > 4 ? `, +${mods.length - 4} more` : "");
  return (
    <div data-deps-banner
      title={`${missing.length === 1 ? "Project import not installed" : `${missing.length} project imports not installed`}: ${shown}\nExternal-call resolution degrades without these. Fix: pip install --target .pydeps ${mods.join(" ")}`}
      style={{
      // A compact chip INSIDE the toolbar (TopToolbar \`notices\`), not a
      // floating banner: centred under the toolbar it covered each view's own
      // controls (the System view's Subsystems / Architecture toggles, the
      // lens bar, the thread view's nests toggle). The full text is the title.
      display: "flex", alignItems: "center", gap: 6,
      background: "color-mix(in oklab, var(--accent-warning) 12%, var(--bg-node))",
      border: "1px solid color-mix(in oklab, var(--accent-warning) 40%, transparent)",
      borderRadius: 6, padding: "4px 8px",
      fontSize: "var(--fs-11)", fontFamily: "var(--font-mono)",
      color: "var(--accent-warning)", whiteSpace: "nowrap", maxWidth: 160,
    }}>
      <PackageX size={14} strokeWidth={1.5} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {missing.length}
      </span>
      <button onClick={onDismiss} title="Dismiss"
        style={{ background: "none", border: "none", color: "var(--accent-warning)",
          cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
