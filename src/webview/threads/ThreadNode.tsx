// React Flow node component for thread-view nodes.
//
// U5 — the per-kind visual is now picked at ThreadView build time
// (icon_for_node.ts + colour_for_node.ts), so this component is a
// dumb renderer:
//   - the Icon prop is the lucide glyph; an optional overlayIcon
//     (Zap) lights up on async function_defs
//   - accentVar / kindLabel drive border + bg + the future U5-tooltip
//     scan label
//   - isCrossFile adds a dashed halo class so cross-file steps read
//     as "this jumps to another file"
//   - routeMethod / routePath render an HTTP method pill + path
//     subtitle on Flask / FastAPI / Django route entries.
//
// One component still handles the terminal-ish thread kinds (seed / step /
// external / dynamic / unresolved / return) so React Flow can map a single
// type.
// The per-kind visuals live in KIND_SHAPE which only carries the
// LAYOUT shape (radius, padding, border weight) — colour/icon come
// from the U3.2 / U5 props.

import React, { useRef } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, type LucideIcon } from "lucide-react";
import type { ThreadNodeKind } from "./types";
import type { AddComponentDropDetail } from "./useAddComponentDrag";
import { tierForZoom, lodLabelFontSize } from "./lod";

export interface ThreadNodeData {
  kind: ThreadNodeKind;
  label: string;
  file: string | null;
  preview: string | null;
  irNodeId: string | null;
  // M12.2 — IR type ("call" / "function_def" / ...) surfaced so the
  // drop handler can include it in the vg-add-component-drop payload.
  // Legal-target inference (M12.3) will gate the data-droppable CSS
  // attribute by (kind, irType); M12.2 marks every node droppable so
  // the stub handler is exercised broadly during manual testing.
  irType?: string | null;
  // U3.2 — accent + scan label.
  accentVar?: string;
  kindLabel?: string;
  // U5 — semantic icon + decoration props. Icon / overlayIcon are
  // React components passed in from ThreadView; we mark them optional
  // so single-file fixtures without an envelope still render with a
  // sensible default.
  Icon?: LucideIcon;
  overlayIcon?: LucideIcon;
  isCrossFile?: boolean;
  routeMethod?: string | null;
  routePath?: string | null;
  // M9.3 — per-file colour wash. fileHueIndex picks the CSS hue var
  // (0..7). fileDepth is informational on the node (the diagonal
  // offset is already baked into position by useThreadLayout); we
  // surface it as data-file-depth for inspector / tests.
  fileHueIndex?: number | null;
  fileDepth?: number | null;
  // M17.1 — surfaced on external terminals whose receiver is a local
  // variable. The tooltip uses `qualifiedTarget` (dotted, importable)
  // as the `qualifiedName` sent to the M13 external-call resolver,
  // instead of the raw label like `parser.add_subparsers`.
  qualifiedTarget?: string;
  viaLocal?: string;
  // R4 — dotted dynamic terminals whose receiver is a runtime-bound
  // local carry the callee that bound it (e.g. "_get_conn" for
  // `conn.execute` after `conn = _get_conn()`).
  receiverBoundFrom?: string;
  // §5.5a — how the dynamic receiver was bound (local-call|param|loop).
  receiverBoundKind?: "local-call" | "param" | "loop";
  // M23 — thread orientation, threaded through so the connection
  // handles sit on the main axis (Top/Bottom vertical, Left/Right
  // horizontal) and edges flow with the layout.
  orientation?: "vertical" | "horizontal";
  // M-NEST L2 — this node wraps extracted nested calls (e.g. F.relu over
  // self.conv1). hasNested shows the expand/collapse badge; nestExpanded
  // drives the glyph direction + the a11y title.
  hasNested?: boolean;
  nestExpanded?: boolean;
  // M-NEST L2g — the source statement hides nested calls (chain / comprehension
  // / literal-embedded) that v1 detected but did NOT decompose. When true and
  // there are no extracted children, the node shows a non-clickable "uncaptured"
  // badge: the path is incomplete here, honestly, never silently complete.
  nestsInnerCalls?: boolean;
  nestExtracted?: boolean;
}

// Per-thread-kind layout shape only — colour comes from the U3.2
// accent picker and is applied via accentVar. dim controls how much
// of the accent shows through (terminals stay quieter).
const KIND_SHAPE: Record<ThreadNodeKind, {
  borderWeight: number;
  cornerRadius: number;
  paddingY: number;
  paddingX: number;
  iconAlpha: number;
  dimmed: boolean;
}> = {
  seed:    { borderWeight: 2, cornerRadius: 8,  paddingY: 10, paddingX: 16, iconAlpha: 1.0, dimmed: false },
  step:    { borderWeight: 1, cornerRadius: 8,  paddingY: 8,  paddingX: 12, iconAlpha: 0.85, dimmed: false },
  external:{ borderWeight: 1, cornerRadius: 16, paddingY: 8,  paddingX: 12, iconAlpha: 0.6,  dimmed: true  },
  // R3 — dynamic is a CONFIDENT call (runtime target): solid, not ghosted.
  dynamic: { borderWeight: 1, cornerRadius: 16, paddingY: 8,  paddingX: 12, iconAlpha: 1.0,  dimmed: false },
  // R3 — unresolved is a low-confidence resolution gap: ghosted (dimmed,
  // like external) so it recedes and reads "couldn't find this", never as
  // a confident runtime-determined node.
  unresolved:{ borderWeight: 1, cornerRadius: 16, paddingY: 8, paddingX: 12, iconAlpha: 0.6, dimmed: true },
  return:  { borderWeight: 1, cornerRadius: 16, paddingY: 8,  paddingX: 12, iconAlpha: 1.0,  dimmed: false },
};

// HTTP method → accent var for the route pill. These map to the
// three-family palette: reads on Family 1 (teal), writes on Family 2
// (DB write blue, since POST/PUT/PATCH mutate state), DELETE on the
// error accent so destructive verbs pop.
const METHOD_ACCENT: Record<string, string> = {
  GET:     "--accent-thread",
  HEAD:    "--accent-thread",
  OPTIONS: "--accent-thread",
  POST:    "--accent-io-write",
  PUT:     "--accent-io-write",
  PATCH:   "--accent-io-write",
  DELETE:  "--accent-error",
};

export function ThreadNode({ id, data }: NodeProps) {
  const d = data as unknown as ThreadNodeData;
  const shape = KIND_SHAPE[d.kind];
  const accentVar = d.accentVar ?? "--accent-thread";
  const Icon = d.Icon ?? ChevronRight;
  const OverlayIcon = d.overlayIcon;
  const isSeed = d.kind === "seed";
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // M-NA7 — semantic-zoom tier. Quantized selector: re-renders only on
  // tier change, never per zoom frame (the continuous inverse scale
  // rides the --vg-inv-zoom CSS var ThreadCanvas maintains).
  const tier = useStore((s) => tierForZoom(s.transform[2]));
  // Overview landmarks: the nodes a map would label at low zoom — the
  // seed, cross-file entries (where the thread changes file), and route
  // handlers. Everything else reads as colored structure.
  const isLandmark = isSeed || !!d.isCrossFile || !!d.routeMethod;
  const showBody = tier === "full";
  const showLabel = tier === "full" || tier === "compact" || isLandmark;

  // U3.1 hover/click eventing — emit anchor rect for the floating
  // tooltip ThreadView mounts.
  const emit = (type: "vg-thread-node-hover" | "vg-thread-node-leave" | "vg-thread-node-click") => {
    const el = wrapRef.current;
    const rect = el?.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent(type, {
      detail: {
        nodeId: id,
        irNodeId: d.irNodeId,
        file: d.file,
        kind: d.kind,
        label: d.label,
        // W6 — the call's source expression (e.g. `torch.stack([self.head(x)
        // for …])`) so the tooltip can show the real call, not just the
        // dotted target.
        preview: d.preview,
        // M17.1 — via-local terminals carry the resolved qualified
        // path so the tooltip can pass it to the external-call resolver.
        qualifiedTarget: d.qualifiedTarget,
        viaLocal: d.viaLocal,
        // R4 + §5.5a — for the honest dynamic-receiver tooltip line.
        receiverBoundFrom: d.receiverBoundFrom,
        receiverBoundKind: d.receiverBoundKind,
        anchor: rect
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : null,
      },
    }));
  };

  const methodAccent = d.routeMethod ? (METHOD_ACCENT[d.routeMethod] ?? "--accent-thread") : null;

  // M12.2 — fire vg-add-component-drop when a release lands on this
  // node during an active add-component drag.
  //
  // M12 diag fix: must listen for `pointerup`, NOT `mouseup`. React
  // Flow calls setPointerCapture() on pointerdown for node drag-and-
  // drop, which by browser spec SUPPRESSES the compatibility mouseup
  // event (https://www.w3.org/TR/pointerevents/#compatibility-mapping-
  // with-mouse-events). Listening for mouseup means the handler never
  // fires when the user is actually on a react-flow node (which is
  // every interesting case). pointerup fires regardless.
  //
  // We also stop propagation AND prevent the synthesized click event:
  // without preventDefault, the browser still synthesises a click after
  // pointerup → vg-thread-node-click → tooltip pin alongside the
  // (now-firing) modal. That's the second half of the user's symptom.
  const onPointerUpForDrop = (e: React.PointerEvent) => {
    if (document.body.dataset.addComponentDragging !== "true") return;
    e.stopPropagation();
    e.preventDefault();
    // Mark the underlying DOM element so the click listener below can
    // skip firing vg-thread-node-click for this interaction.
    (e.currentTarget as HTMLElement).dataset.suppressNextClick = "1";
    const detail: AddComponentDropDetail = {
      targetNodeId: id,
      targetIrNodeId: d.irNodeId,
      targetFile: d.file,
      targetKind: d.kind,
      irType: d.irType ?? null,
      // M12.3 — snapshot modifier keys at drop time so the App-level
      // resolver can apply PLAN-v3 §4.2 overrides (alt → picker,
      // shift → before, ctrl/cmd → after).
      modifiers: {
        alt: e.altKey,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
      },
    };
    document.dispatchEvent(new CustomEvent<AddComponentDropDetail>("vg-add-component-drop", { detail }));
  };

  // M12 diag fix: click-suppress when a drop just dispatched on this
  // node. The post-pointerup browser-synthesized click would otherwise
  // pin the U3.1 tooltip alongside the AddComponentModal.
  const onClickMaybeSuppressed = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (el.dataset.suppressNextClick === "1") {
      delete el.dataset.suppressNextClick;
      e.stopPropagation();
      return;
    }
    emit("vg-thread-node-click");
  };

  return (
    <div
      ref={wrapRef}
      onMouseEnter={() => emit("vg-thread-node-hover")}
      onMouseLeave={() => emit("vg-thread-node-leave")}
      onClick={onClickMaybeSuppressed}
      onPointerUp={onPointerUpForDrop}
      data-add-component-droppable="true"
      data-lod={tier}
      data-ir-type={d.irType ?? ""}
      data-accent-var={accentVar}
      data-kind-label={d.kindLabel ?? ""}
      data-icon-name={(Icon as any).displayName ?? (Icon as any).name ?? ""}
      data-route-method={d.routeMethod ?? ""}
      data-file-hue={d.fileHueIndex != null ? String(d.fileHueIndex) : undefined}
      data-file-depth={d.fileDepth != null ? String(d.fileDepth) : undefined}
      className={[
        "vg-thread-node",
        `vg-thread-node-${d.kind}`,
        d.isCrossFile ? "vg-thread-node-cross-file" : "",
      ].filter(Boolean).join(" ")}
      style={{
        position: "relative",
        background: `color-mix(in oklab, var(${accentVar}) ${shape.dimmed ? 6 : 12}%, var(--bg-node))`,
        border: `${shape.borderWeight}px solid color-mix(in oklab, var(${accentVar}) ${shape.dimmed ? 35 : 70}%, transparent)`,
        borderRadius: shape.cornerRadius,
        padding: `${shape.paddingY}px ${shape.paddingX}px`,
        minWidth: 120,
        maxWidth: 220,
        fontFamily: "var(--font-mono)",
        fontSize: isSeed ? "var(--fsm-13)" : "var(--fsm-12)",
        color: "var(--text-primary)",
        opacity: shape.dimmed ? 0.85 : 1,
        boxShadow: isSeed ? "var(--shadow-panel)" : "var(--shadow-control)",
        transition: `transform var(--motion-hover-dur) var(--motion-hover-ease)`,
        // M9.3 — feed the per-file hue into the ::before pseudo-element
        // selector. Null/undefined → CSS ignores it (no wash).
        ...(d.fileHueIndex != null
          ? { ["--vg-file-hue" as any]: `var(--thread-file-hue-${d.fileHueIndex})` }
          : {}),
      }}
    >
      {/* M23 — handles follow the layout's main axis: edges enter from
          the left and exit right in horizontal mode, top/bottom in
          vertical. Without this, L-R edges left the bottom of one card
          and curled into the top of the next — the M21 "wavy edges". */}
      <Handle
        type="target"
        position={d.orientation === "horizontal" ? Position.Left : Position.Top}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <Handle
        type="source"
        position={d.orientation === "horizontal" ? Position.Right : Position.Bottom}
        style={{ opacity: 0, pointerEvents: "none" }}
      />

      {/* U5 — HTTP method pill, top-left, only on route handlers.
          M-NA7 — full tier only: at compact/overview the pill is
          sub-legible chrome; the scaled landmark label carries identity. */}
      {tier === "full" && d.routeMethod && methodAccent && (
        <div
          className="vg-thread-node-method-pill"
          data-method={d.routeMethod}
          style={{
            position: "absolute",
            top: -10,
            left: 8,
            padding: "1px 6px",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            fontFamily: "var(--font-mono)",
            color: `var(${methodAccent})`,
            background: `color-mix(in oklab, var(${methodAccent}) 18%, var(--bg-canvas))`,
            border: `1px solid color-mix(in oklab, var(${methodAccent}) 55%, transparent)`,
            borderRadius: 4,
            lineHeight: 1.35,
          }}
        >
          {d.routeMethod}
        </div>
      )}

      {/* M-NEST L2 — nest badge, top-right. Teal (Family-1, structural — a nest
          is navigation, not severity). Two honest states:
            • EXTRACTED (hasNested): clickable, toggles the nest open/closed; the
              glyph shows the current state. Solid border.
            • UNCAPTURED (nestsInnerCalls && !nestExtracted): the statement hides
              calls v1 detected but did not decompose (chains / comprehensions /
              literals). Non-clickable, DASHED border — the path is incomplete
              here, signalled, never silently complete. */}
      {tier !== "full" ? null : d.hasNested ? (
        <div
          className="vg-thread-nest-badge"
          data-nest-badge
          data-nest-expanded={d.nestExpanded ? "true" : "false"}
          role="button"
          tabIndex={0}
          title={d.nestExpanded ? "Collapse nested calls" : "Expand nested calls"}
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent("vg-toggle-nest", { detail: { nodeId: id } }));
          }}
          style={{
            position: "absolute",
            top: -10,
            right: 8,
            display: "flex",
            alignItems: "center",
            gap: 3,
            padding: "1px 6px",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: "var(--font-ui)",
            color: "var(--accent-thread)",
            background: "color-mix(in oklab, var(--accent-thread) 18%, var(--bg-canvas))",
            border: "1px solid color-mix(in oklab, var(--accent-thread) 55%, transparent)",
            borderRadius: 4,
            lineHeight: 1.35,
            cursor: "pointer",
          }}
        >
          {d.nestExpanded
            ? <ChevronsDownUp size={11} strokeWidth={1.8} />
            : <ChevronsUpDown size={11} strokeWidth={1.8} />}
          nests
        </div>
      ) : d.nestsInnerCalls && !d.nestExtracted ? (
        <div
          className="vg-thread-nest-badge"
          data-nest-badge
          data-nest-uncaptured="true"
          title="Hides nested calls not yet decomposed (chain / comprehension / literal) — the path is incomplete here"
          style={{
            position: "absolute",
            top: -10,
            right: 8,
            display: "flex",
            alignItems: "center",
            gap: 3,
            padding: "1px 6px",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: "var(--font-ui)",
            color: "color-mix(in oklab, var(--accent-thread) 70%, var(--text-muted))",
            background: "color-mix(in oklab, var(--accent-thread) 10%, var(--bg-canvas))",
            border: "1px dashed color-mix(in oklab, var(--accent-thread) 45%, transparent)",
            borderRadius: 4,
            lineHeight: 1.35,
          }}
        >
          <ChevronsUpDown size={11} strokeWidth={1.8} />
          nests*
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ position: "relative", flexShrink: 0, lineHeight: 0 }}>
          <Icon
            size={isSeed ? 18 : 16}
            strokeWidth={1.5}
            style={{ color: `var(${accentVar})`, opacity: shape.iconAlpha }}
          />
          {/* U5 — async overlay. Tiny Zap on the bottom-right of the
              main icon; visible only when ThreadView decided this is
              an `async def`. */}
          {OverlayIcon && (
            <OverlayIcon
              size={10}
              strokeWidth={1.8}
              style={{
                position: "absolute",
                right: -4,
                bottom: -4,
                color: "var(--accent-warning)",
                background: "var(--bg-node)",
                borderRadius: 999,
                padding: 1,
              }}
            />
          )}
        </div>
        {tier === "full" && (
          <div
            className="vg-node-code"
            style={{ fontWeight: isSeed ? 600 : 500 }}
            title={d.label}
          >
            {d.label}
          </div>
        )}
      </div>

      {/* M-NA7 — below full tier the label leaves the card: rendered
          outside at inverse-zoom scale (~constant on-screen size), so
          it stays readable without inflating the card or shifting
          layout. Overview shows landmark labels only. */}
      {tier !== "full" && showLabel && (
        <div
          className="vg-node-code vg-thread-lod-label"
          data-lod-label
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 6,
            fontSize: lodLabelFontSize(isLandmark ? 13 : 12, 80),
            fontWeight: isSeed ? 600 : 500,
            color: isLandmark ? "var(--text-primary)" : "var(--text-secondary)",
            whiteSpace: "nowrap",
            lineHeight: 1.1,
            pointerEvents: "none",
          }}
        >
          {d.label}
        </div>
      )}

      {/* Secondary metadata row.
          U5 — route path takes precedence over the file-path/preview
          fallback so route handlers read as `POST /users` instead of
          just `app.py`. Non-route nodes keep the existing file-path
          or preview row. M-NA7 — full tier only. */}
      {showBody && (d.routePath || d.file || d.preview) && !isSeed && (
        <div
          className="vg-node-code"
          style={{
            marginTop: 4,
            fontSize: "var(--fsm-12)",
            color: d.routePath ? `var(${accentVar})` : "var(--text-muted)",
            opacity: d.routePath ? 0.9 : 0.7,
          }}
          title={d.routePath ?? d.file ?? d.preview ?? ""}
        >
          {d.routePath ?? d.file ?? d.preview}
        </div>
      )}
    </div>
  );
}
