// As-built subsystem-kind -> token + icon mapping for the system view
// (M19.2). This module owns only the *application*; the palette
// philosophy (the three families, within-vs-across rule) lives in the
// vibegraph-aesthetic skill — defer there before changing a hue.
//
// Mapping rationale (Python-centric, three families):
//   - backend / library -> logic family (--accent-thread): the user's
//     program. library is internal code with no real entry point, so it
//     reads in the same family, one step quieter.
//   - db / external_http / cache -> I/O boundary family (blue), with
//     within-family value variation carrying "persistence weight":
//     db (persistent state) brightest, http (network) mid, cache
//     (ephemeral) muted.
//   - frontend -> configuration/setup family (--accent-config, warm):
//     the non-Python client; a peer that isn't the program itself.

import {
  Server, AppWindow, Database, Zap, Globe, Library,
  type LucideIcon,
} from "lucide-react";
import type { SubsystemKind } from "../types";

interface SubsystemVisual {
  /** CSS custom-property name (bind, never hardcode). */
  accent: string;
  icon: LucideIcon;
  /** Lower-emphasis cards read quieter without leaving their family. */
  quiet?: boolean;
}

const VISUAL: Record<SubsystemKind, SubsystemVisual> = {
  backend: { accent: "--accent-thread", icon: Server },
  library: { accent: "--accent-thread", icon: Library, quiet: true },
  db: { accent: "--accent-io-write", icon: Database },
  external_http: { accent: "--accent-io", icon: Globe },
  cache: { accent: "--accent-io-muted", icon: Zap },
  frontend: { accent: "--accent-config", icon: AppWindow },
};

export function subsystemVisual(kind: SubsystemKind): SubsystemVisual {
  return VISUAL[kind] ?? VISUAL.backend;
}

/** The card's secondary line answers "how was this detected?" for a
 *  human reader. IR evidence strings (`name-match`, `effectKind:db`) are
 *  the right vocabulary for Claude/MCP but must not leak onto the card. */
const EVIDENCE_LABEL: Record<string, string> = {
  "name-match": "matched by name",
  "effectKind:db": "detected from database calls",
  "effectKind:http": "detected from HTTP calls",
};

export function evidenceLabel(evidence: string): string {
  return EVIDENCE_LABEL[evidence] ?? evidence;
}

/** Edge accent: effect edges take their TARGET subsystem's accent so the
 *  eye follows the I/O colour out to the boundary; low-confidence
 *  string-scan calls edges recede into the config family. */
export function edgeAccent(
  kind: "calls" | "effect",
  targetKind: SubsystemKind,
): string {
  return kind === "calls" ? "--accent-config" : subsystemVisual(targetKind).accent;
}
