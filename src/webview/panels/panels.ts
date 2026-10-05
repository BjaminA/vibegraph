// Every panel the sheet hosts (GUI brief M3): one row each — its id, its
// tint hue, its title, its icon and the subtitle it opens with. The sheet,
// the switcher and the tint are derived from the row: a new panel is one row.

import { DraftingCompass, Scale, Layers, Bot, Compass, Cpu, ClipboardList, type LucideIcon } from "lucide-react";

export type PanelId = "plan" | "rules" | "stack" | "agents" | "direction" | "models" | "board";

export interface PanelSpec { id: PanelId; hue: number; title: string; icon: LucideIcon; subtitle: string }

export const PANELS: readonly PanelSpec[] = [
  { id: "plan",      hue: 210, title: "Plan",          icon: DraftingCompass, subtitle: "hypothetical: a plan, not the code" },
  { id: "rules",     hue: 45,  title: "Rules",         icon: Scale,           subtitle: "the stated rules, checked after every edit" },
  { id: "stack",     hue: 195, title: "Stack",         icon: Layers,          subtitle: "what the project is built on" },
  { id: "agents",    hue: 166, title: "Agent Manager", icon: Bot,             subtitle: "plan a task onto threads, review each packet" },
  { id: "direction", hue: 290, title: "Direction",     icon: Compass,         subtitle: "generic direction skills, advisory" },
  { id: "models",    hue: 250, title: "Models",        icon: Cpu,             subtitle: "which model runs which kind of work" },
  { id: "board",     hue: 25,  title: "Board",         icon: ClipboardList,   subtitle: "nodes you pinned, your notes, a handoff" },
];

export const panelSpec = (id: PanelId): PanelSpec => PANELS.find((p) => p.id === id)!;
