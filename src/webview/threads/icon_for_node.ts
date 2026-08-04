// U5 — pure icon picker for thread nodes.
//
// Maps the kindLabel returned by accentForThreadNode (U3.2) plus the
// node's IR (for the async overlay) to a lucide icon component.
// Keeping the mapping table-driven so a future tweak shows up in the
// snapshot spec rather than scattered branches.
//
// The accent picker already classifies the node by family; this just
// chooses the glyph that pairs with it. Cross-family icons reuse the
// same Lucide visual where it makes sense (Globe for both ROUTE and
// HTTP — they ARE the same concept, just different layers).

import {
  // Family 1 — logic / control
  Target, Play, Box, FileText, AlertTriangle, GitBranch,
  ArrowRightToLine, RotateCw, ChevronRight, Equal,
  Terminal, Globe, FlaskConical, Plug, Pin,
  // Family 2 — I/O
  Database, Plus, ListChecks, HardDrive, Wifi, ScrollText, Printer,
  ArrowDownLeft,
  // Family 3 — config
  Settings,
  // Overlay
  Zap, HelpCircle, Shuffle,
  type LucideIcon,
} from "lucide-react";

import type { ThreadNode as ThreadNodeJSON } from "./types";
import type { AstNode } from "../../shared/protocol";

export interface ThreadNodeIcon {
  Icon: LucideIcon;
  overlayIcon?: LucideIcon;
}

// kindLabel → glyph. Falls back to ChevronRight for anything unknown
// so we never render an empty node. The mapping pairs with the accent
// families in colour_for_node.ts:
//   Family 1 (teal) — work / structure glyphs
//   Family 2 (blue) — boundary / data glyphs
//   Family 3 (warm) — Settings sliders
const KIND_LABEL_ICON: Record<string, LucideIcon> = {
  // Family 1 — logic
  FN:           Play,
  "ASYNC FN":   Play,            // overlay set to Zap below
  CLI:          Terminal,
  ROUTE:        Globe,
  TEST:         FlaskConical,
  API:          Plug,
  PINNED:       Pin,
  CLASS:        Box,
  DATA:         FileText,
  EXCEPTION:    AlertTriangle,
  BRANCH:       GitBranch,
  RAISE:        AlertTriangle,
  RETURN:       ArrowRightToLine,
  LOOP:         RotateCw,
  IMPORT:       ArrowDownLeft,
  // Family 2 — I/O
  "DB WRITE":   Plus,
  "DB READ":    ListChecks,
  DB:           Database,
  HTTP:         Wifi,
  FS:           HardDrive,
  SHELL:        Terminal,
  LOG:          ScrollText,
  "I/O":        Printer,
  // Family 3 — config
  CONFIG:       Settings,
  // Generic fall-throughs
  CALL:         ChevronRight,
  ASSIGN:       Equal,
  EXTERNAL:     Box,
  // R3 — DYNAMIC (genuine runtime dispatch) reads as "could route to
  // different targets at runtime" → Shuffle. The HelpCircle "?" now
  // belongs to UNRESOLVED ("couldn't find this"), where the question-mark
  // semantics are honest.
  DYNAMIC:      Shuffle,
  UNRESOLVED:   HelpCircle,
  SEED:         Target,
};

export function iconForNode(
  kindLabel: string,
  ir: AstNode | null,
  threadNodeKind: ThreadNodeJSON["kind"],
): ThreadNodeIcon {
  // Seed gets the Target glyph regardless of inner kind; it's the
  // user's anchor. The accent picker already returns kindLabel
  // matching the inner type, but we override on `kind === "seed"`
  // so the entry point reads as a target on the canvas.
  if (threadNodeKind === "seed") {
    // …but if the seed has an entry-point flavour, prefer that
    // (Globe for routes, Terminal for CLI etc.) so the seed icon
    // already tells you what kind of program this is.
    const epIcon = KIND_LABEL_ICON[kindLabel];
    if (epIcon && epIcon !== Play) return wrap(epIcon, ir);
    return wrap(Target, ir);
  }

  const Icon = KIND_LABEL_ICON[kindLabel] ?? ChevronRight;
  return wrap(Icon, ir);
}

function wrap(Icon: LucideIcon, ir: AstNode | null): ThreadNodeIcon {
  if (ir?.type === "function_def" && ir.isAsync) {
    return { Icon, overlayIcon: Zap };
  }
  return { Icon };
}

// Exported for the spec to assert specific icon choices without
// importing the lucide module in the test file.
export function iconNameFor(
  kindLabel: string,
  threadNodeKind: ThreadNodeJSON["kind"],
): string {
  if (threadNodeKind === "seed") {
    const epIcon = KIND_LABEL_ICON[kindLabel];
    if (epIcon && epIcon !== Play) return epIcon.displayName ?? epIcon.name ?? "Unknown";
    return Target.displayName ?? "Target";
  }
  const Icon = KIND_LABEL_ICON[kindLabel] ?? ChevronRight;
  return Icon.displayName ?? Icon.name ?? "Unknown";
}
