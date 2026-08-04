// Layer-type → token + icon + tier mapping for the architecture schematic.
// Owns only the *application*; the palette philosophy (families, within-vs-
// across rule) lives in the vibegraph-aesthetic skill — defer there before
// changing a hue. Mirrors system/subsystem_visual.ts.
//
// Tier splits the schematic into PRIMARY compute blocks (conv / linear / pool
// / recurrent / attention / embedding — full glyph cards) and inline MARKERS
// (norm / dropout / activation / reshape — small quiet chips), per the brief's
// "conv = block … norm/dropout/activation = inline markers".

import {
  Layers, Grid3x3, Shrink, Ruler, Droplets, Zap, Repeat, Share2, Hash,
  Boxes, Shuffle, Box, type LucideIcon,
} from "lucide-react";

export type LayerCategory =
  | "conv" | "linear" | "pool" | "norm" | "dropout" | "activation"
  | "recurrent" | "attention" | "embedding" | "container" | "reshape" | "unknown";

export interface LayerVisual {
  category: LayerCategory;
  /** CSS custom-property name (bind, never hardcode). */
  accent: string;
  icon: LucideIcon;
  /** primary compute block vs inline marker. */
  tier: "primary" | "marker";
}

// Ordered matchers: first hit wins. Substring/prefix on the layer class name
// (the last segment of callTarget, e.g. "Conv2d", "BatchNorm2d").
const MATCHERS: Array<{ test: RegExp; vis: Omit<LayerVisual, "category"> & { category: LayerCategory } }> = [
  { test: /Conv/, vis: { category: "conv", accent: "--accent-io", icon: Layers, tier: "primary" } },
  { test: /^(Linear|LazyLinear|Bilinear)$/, vis: { category: "linear", accent: "--accent-thread", icon: Grid3x3, tier: "primary" } },
  { test: /Pool/, vis: { category: "pool", accent: "--accent-io-muted", icon: Shrink, tier: "primary" } },
  { test: /(LSTM|GRU|RNN)/, vis: { category: "recurrent", accent: "--accent-thread", icon: Repeat, tier: "primary" } },
  { test: /(MultiheadAttention|Transformer|Attention)/, vis: { category: "attention", accent: "--accent-chat", icon: Share2, tier: "primary" } },
  { test: /Embedding/, vis: { category: "embedding", accent: "--accent-io", icon: Hash, tier: "primary" } },
  { test: /(Sequential|ModuleList|ModuleDict)/, vis: { category: "container", accent: "--accent-thread", icon: Boxes, tier: "primary" } },
  { test: /Norm/, vis: { category: "norm", accent: "--accent-config", icon: Ruler, tier: "marker" } },
  { test: /Dropout/, vis: { category: "dropout", accent: "--accent-config", icon: Droplets, tier: "marker" } },
  { test: /(ReLU|GELU|ELU|SiLU|Sigmoid|Tanh|Softmax|Mish|Hardswish|LeakyReLU)/, vis: { category: "activation", accent: "--accent-warning", icon: Zap, tier: "marker" } },
  { test: /(Flatten|Unflatten|Identity|Reshape|Permute)/, vis: { category: "reshape", accent: "--accent-io-muted", icon: Shuffle, tier: "marker" } },
];

const UNKNOWN: LayerVisual = { category: "unknown", accent: "--text-muted", icon: Box, tier: "marker" };

export function layerVisual(layerType: string): LayerVisual {
  for (const m of MATCHERS) if (m.test.test(layerType)) return m.vis;
  return UNKNOWN;
}
