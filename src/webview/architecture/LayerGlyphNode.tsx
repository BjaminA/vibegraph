// Architecture-view custom react-flow nodes: a typed layer glyph + a model
// header. Token-bound, lucide icons, hover-lift via transform/box-shadow
// (never `filter` — the hit-test caveat). House style copied from
// system/SubsystemNode.tsx.

import React, { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  Boxes, Layers, Repeat, Share2, Grid3x3, Combine, HelpCircle, type LucideIcon,
} from "lucide-react";
import type { ArchLayer, ArchModel, NetTypeLabel } from "./architecture";
import { layerVisual, type LayerVisual } from "./layer_visual";

export const GLYPH_W = 232;
export const PRIMARY_H = 66;
export const MARKER_H = 44;
export const HEADER_H = 64;

// Compact param count: 896 → "896", 18496 → "18.5K", 1_200_000 → "1.2M".
function formatParams(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

// Net-type symbol — icon + accent per classified label. unknown recedes to
// muted (an absence of classification shouldn't claim a meaning).
const NET_VISUAL: Record<NetTypeLabel, { icon: LucideIcon; accent: string }> = {
  convolutional: { icon: Layers, accent: "--accent-io" },
  recurrent: { icon: Repeat, accent: "--accent-thread" },
  transformer: { icon: Share2, accent: "--accent-chat" },
  mlp: { icon: Grid3x3, accent: "--accent-thread" },
  hybrid: { icon: Combine, accent: "--accent-compose" },
  unknown: { icon: HelpCircle, accent: "--text-muted" },
};

export function LayerGlyphNode({
  data,
}: {
  data: { layer: ArchLayer; visual: LayerVisual; model?: { className: string } };
}) {
  const [hover, setHover] = useState(false);
  const { layer, visual, model } = data;
  const a = `var(${visual.accent})`;
  const marker = visual.tier === "marker";
  const Icon = visual.icon;
  // W5 — the glyph navigates to the model's forward() thread (handled at the
  // react-flow pane level in ArchitectureView's onNodeClick).
  const navTitle = model ? `Trace ${model.className}.forward() — this layer's data path` : undefined;

  return (
    <div
      data-layer-glyph
      data-layer-name={layer.name}
      data-layer-type={layer.type}
      data-layer-tier={visual.tier}
      title={navTitle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: GLYPH_W,
        height: marker ? MARKER_H : PRIMARY_H,
        boxSizing: "border-box",
        background: "var(--bg-node)",
        border: `1px solid color-mix(in oklab, ${a} ${hover ? 70 : 45}%, transparent)`,
        borderLeft: `${marker ? 3 : 5}px solid ${a}`,
        borderRadius: marker ? 8 : 10,
        padding: marker ? "6px 12px" : "8px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        opacity: marker ? 0.9 : 1,
        cursor: model ? "pointer" : "default",
        transform: hover ? "translateY(-1px) scale(1.01)" : "none",
        transition: "transform var(--motion-hover-dur) var(--motion-hover-ease), border-color var(--motion-hover-dur) var(--motion-hover-ease)",
        boxShadow: hover ? "var(--shadow-control)" : "none",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />

      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: marker ? 22 : 28, height: marker ? 22 : 28, borderRadius: 7, flexShrink: 0,
          background: `color-mix(in oklab, ${a} 14%, transparent)`,
          color: a,
        }}
      >
        <Icon size={marker ? 14 : 16} strokeWidth={1.5} />
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-ui)", fontSize: marker ? "var(--fs-11)" : "var(--fs-13)",
              fontWeight: 600, color: "var(--text-primary)",
            }}
          >
            {layer.type}
          </span>
          <span
            className="vg-node-code"
            style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--text-muted)",
            }}
            title={layer.name}
          >
            {layer.name}
          </span>
        </div>
        {!marker && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
            <span
              className="vg-node-code"
              style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--text-secondary)",
                flex: 1, minWidth: 0,
              }}
              title={layer.argsPreview}
            >
              {layer.argsPreview}
            </span>
            {layer.paramCount != null && (
              <span
                data-layer-params
                title={`${layer.paramCount.toLocaleString()} parameters`}
                style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)", flexShrink: 0 }}
              >
                {formatParams(layer.paramCount)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ModelHeaderNode({
  data,
}: {
  data: { model: ArchModel; onOpenForward?: (model: ArchModel) => void };
}) {
  const m = data.model;
  const net = m.netType;
  const nv = NET_VISUAL[net.label];
  const lowConf = net.confidence === "low";
  // Confidence-honest: low confidence recedes (muted accent, dashed border,
  // dimmed). The copy hedges ("Looks like …") and never bare-claims.
  const chipAccent = lowConf ? "var(--text-muted)" : `var(${nv.accent})`;
  const NetIcon = nv.icon;
  const openable = m.hasForward && !!data.onOpenForward;

  return (
    <div
      data-model-header
      data-model-name={m.className}
      data-net-type={net.label}
      data-net-confidence={net.confidence}
      title={openable ? `Trace ${m.className}.forward() as a data-path thread` : undefined}
      style={{
        width: GLYPH_W,
        height: HEADER_H,
        boxSizing: "border-box",
        background: "color-mix(in oklab, var(--accent-thread) 8%, var(--bg-node))",
        border: "1px solid color-mix(in oklab, var(--accent-thread) 40%, transparent)",
        borderRadius: 10,
        padding: "8px 12px",
        cursor: openable ? "pointer" : "default",
        display: "flex", flexDirection: "column", justifyContent: "center", gap: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            background: "color-mix(in oklab, var(--accent-thread) 16%, transparent)",
            color: "var(--accent-thread)",
          }}
        >
          <Boxes size={16} strokeWidth={1.5} />
        </div>
        <div
          style={{
            // Sitting-2 — full-text wrap (M-GF3.1 rule): the model name is
            // load-bearing content, never ellipsized. Long names wrap; the
            // title keeps the recognition provenance.
            fontFamily: "var(--font-ui)", fontSize: "var(--fs-14)", fontWeight: 700,
            color: "var(--text-primary)", minWidth: 0, overflowWrap: "anywhere", lineHeight: 1.3,
          }}
          title={`${m.className} — ${m.recognizedBy}`}
        >
          {m.className}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 1 }}>
        {/* net-type symbol — hedged copy + evidence in the title. */}
        <div
          data-net-chip
          title={`Looks like ${net.display === "Unknown" ? "an unrecognized architecture" : net.display} — ${net.evidence}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "1px 7px", borderRadius: 5,
            background: `color-mix(in oklab, ${chipAccent} ${lowConf ? 8 : 14}%, transparent)`,
            border: `1px ${lowConf ? "dashed" : "solid"} color-mix(in oklab, ${chipAccent} ${lowConf ? 35 : 50}%, transparent)`,
            color: chipAccent,
            opacity: lowConf ? 0.8 : 1,
            fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", fontWeight: 600,
          }}
        >
          <NetIcon size={12} strokeWidth={1.5} />
          {lowConf ? "?" : "~"} {net.display}
        </div>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}>
          {m.layers.length} layers
        </span>
        {/* M-FS9 — when nested one-liners (pool(relu(conv1(x)))) hide
            layers from forward()'s outermost-call walk, part of the
            stack rides in DECLARATION order and the drawn arrows can
            reverse the real flow. Say so instead of letting the
            schematic quietly claim a data path it doesn't know. */}
        {m.orderDerivation !== "forward" && (
          <span
            data-order-fallback={m.orderDerivation}
            title="The parser can't fully derive forward()'s application order (nested one-liners hide it), so part of the drawn order follows source text — the arrows may not match the applied flow. Open the forward thread for the true path."
            style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-muted)" }}
          >
            approx. order
          </span>
        )}
        {m.forwardHasControlFlow && (
          <span
            data-forward-branches
            title="forward() has conditional branches — the schematic stacks layers in source order; open the forward thread for the true branched path"
            style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--accent-warning)" }}
          >
            ⎇ branches
          </span>
        )}
        {openable && (
          <span
            data-open-forward
            style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--accent-thread)", marginLeft: "auto" }}
          >
            forward ▸
          </span>
        )}
      </div>
    </div>
  );
}

export { layerVisual };
