// The operation vocabulary's icons (src/shared/operations.json names them):
// lucide only, looked up by name; a project word naming an icon not here
// gets a plain circle rather than a missing glyph.

import {
  Server, Monitor, ArrowUpRight, Terminal, Split, ArrowDownToLine, ArrowUpFromLine, Eye,
  Database, ListOrdered, GitFork, ShieldCheck, Shuffle, Circle, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Server, Monitor, ArrowUpRight, Terminal, Split, ArrowDownToLine, ArrowUpFromLine, Eye,
  Database, ListOrdered, GitFork, ShieldCheck, Shuffle,
};

export const opIcon = (name: string): LucideIcon => ICONS[name] ?? Circle;
