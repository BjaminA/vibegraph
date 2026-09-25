// M-ARCH.5 — the architecture map's category → accent TOKEN, apart from the
// icons (arch_visual.ts) so the deterministic layout (archLayout.ts) can be
// imported by the Node side — the self-contained `architecture.html` is laid
// out by the same function the view uses, and a CLI bundle must not carry
// lucide or React to get a colour name. Bind tokens, never hex.

import type { ArchCategory } from "../../shared/arch_protocol.ts";

export const ARCH_ACCENT: Record<ArchCategory, { accent: string; quiet?: boolean }> = {
  frontend: { accent: "--accent-config" },
  backend: { accent: "--accent-thread" },
  scripts: { accent: "--accent-thread" },
  agent: { accent: "--accent-thread" },
  pipeline: { accent: "--accent-thread", quiet: true },
  platform: { accent: "--accent-io-write" },
  database: { accent: "--accent-io-write" },
  cache: { accent: "--accent-io-muted" },
  storage: { accent: "--accent-io-muted" },
  queue: { accent: "--accent-io" },
  model: { accent: "--accent-io" },
  cloud: { accent: "--accent-io" },
  external: { accent: "--accent-io", quiet: true },
  unknown: { accent: "--text-muted", quiet: true },
};

export function archAccent(c: ArchCategory): { accent: string; quiet?: boolean } {
  return ARCH_ACCENT[c] ?? ARCH_ACCENT.unknown;
}
