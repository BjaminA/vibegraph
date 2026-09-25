// M-ARCH.2 — legend category → accent token + icon for the architecture
// map. The three accent families of tokens.css, applied: the PROGRAM (the
// project's own clusters) in the logic family, what it TALKS TO (tools) in
// the I/O family with persistence weight carried by value (a database
// brightest, an unclassified tool muted), the web app in the config family
// (the M19 frontend precedent). Bind tokens, never hex.

import {
  AppWindow, Server, TerminalSquare, Bot, Workflow, Layers, Database, Zap, Radio,
  Sparkles, Cloud, Globe, Circle, FolderOpen, type LucideIcon,
} from "lucide-react";
import type { ArchCategory } from "../../shared/arch_protocol";
import { archAccent } from "./arch_accent";

export interface ArchVisual { accent: string; icon: LucideIcon; quiet?: boolean }

const ICON: Record<ArchCategory, LucideIcon> = {
  frontend: AppWindow, backend: Server, scripts: TerminalSquare, agent: Bot, pipeline: Workflow,
  platform: Layers, database: Database, cache: Zap, storage: FolderOpen, queue: Radio, model: Sparkles, cloud: Cloud,
  external: Globe, unknown: Circle,
};

export function archVisual(c: ArchCategory): ArchVisual {
  return { ...archAccent(c), icon: ICON[c] ?? Circle };
}
