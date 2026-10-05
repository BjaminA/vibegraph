// The theme switch in the toolbar (2026-10-05, GUI brief M1).

import React, { useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { readTheme, saveTheme, THEMES, type ThemeChoice } from "./theme";
import { ToolButton } from "./TopToolbar";

/** 2026-10-05 — dark (the default) → light → follow the system, remembered. */
export function ThemeButton() {
  const [t, setT] = useState<ThemeChoice>(readTheme);
  const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
  const Icon = t === "light" ? Sun : t === "dark" ? Moon : Monitor;
  return (
    <ToolButton data-theme-toggle={t} active={false} accent="var(--text-muted)"
      title={`Theme: ${t === "system" ? "follow the system" : t} — click for ${next === "system" ? "follow the system" : next}`}
      onClick={() => { saveTheme(next); setT(next); }}>
      <Icon size={16} strokeWidth={1.5} />
    </ToolButton>
  );
}
