// M16.2 — drag-from-handle state machine for the blank thread node.
//
// The blank node's handle dispatches `vg-thread-blank-linker-start` on
// pointerdown. This component, mounted once at the ThreadView level,
// listens for that event, captures the pointer at the document level
// (so the drag keeps tracking even if the cursor crosses the canvas
// gap), renders a transient SVG bezier from the handle origin to the
// cursor while the user is dragging, and on pointerup walks the
// elementsFromPoint stack to find a thread node to land on.
//
// State machine (data-thread-linker-state on document.body for tests):
//   idle → linking → linked  → idle (fires vg-thread-link-drop)
//   idle → linking → rejected → idle (fires vg-thread-link-drop with rejected=true)
//
// Per PLAN-v4 §4.6 M16.2 "no actual wiring yet — just the interaction":
// vg-thread-link-drop is the contract; M16.3 hooks into it to classify
// the target and transform the blank into a typed thread node.
//
// Cross-cutting lesson from M12 (memory project-v4-progress):
//   - react-flow's setPointerCapture suppresses compat mouseup events,
//     so we use *pointerup* (not mouseup) as the release trigger.
//   - elementsFromPoint(clientX, clientY) is the correct hit-test —
//     the react-flow pane and edge paths sit above nodes in DOM paint
//     order, so e.target is unreliable.

import React, { useEffect, useRef, useState } from "react";

interface LinkerOrigin {
  x: number;
  y: number;
}

interface LinkerState {
  blankId: string;
  origin: LinkerOrigin;
  cursor: LinkerOrigin;
}

type LinkDropDetail =
  | {
      sourceBlankId: string;
      targetNodeId: string;
      targetIrNodeId: string | null;
      rejected: false;
    }
  | { sourceBlankId: string; rejected: true; reason: string };

function setBodyState(state: "idle" | "linking" | "linked" | "rejected"): void {
  if (state === "idle") {
    delete document.body.dataset.threadLinkerState;
  } else {
    document.body.dataset.threadLinkerState = state;
  }
}

export function ThreadNodeLinker(): React.ReactElement | null {
  const [state, setState] = useState<LinkerState | null>(null);
  const stateRef = useRef<LinkerState | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Listen for the blank node's pointerdown event and enter linking mode.
  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<{
        blankId: string;
        origin: LinkerOrigin;
      }>).detail;
      if (!detail?.blankId || !detail.origin) return;
      setState({
        blankId: detail.blankId,
        origin: detail.origin,
        cursor: detail.origin,
      });
      setBodyState("linking");
    };
    document.addEventListener("vg-thread-blank-linker-start", onStart);
    return () => document.removeEventListener("vg-thread-blank-linker-start", onStart);
  }, []);

  // While linking: track cursor, watch for pointerup, resolve target.
  useEffect(() => {
    if (!state) return;

    const onMove = (e: PointerEvent) => {
      setState((s) => (s ? { ...s, cursor: { x: e.clientX, y: e.clientY } } : s));
    };

    const finish = (
      detail: LinkDropDetail,
      finalState: "linked" | "rejected",
    ) => {
      setBodyState(finalState);
      document.dispatchEvent(
        new CustomEvent("vg-thread-link-drop", { detail }),
      );
      // Reset to idle on the next tick so tests can read the terminal
      // state attribute, then we clear it.
      window.setTimeout(() => {
        setBodyState("idle");
        setState(null);
      }, 0);
    };

    const onUp = (e: PointerEvent) => {
      const current = stateRef.current;
      if (!current) return;
      const stack = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[];
      // Find the topmost react-flow node that ISN'T the source blank.
      const target = stack.find(
        (el) =>
          el.classList?.contains("react-flow__node") &&
          el.dataset.blankId !== current.blankId &&
          // Also skip the blank node by its data attribute on the inner div.
          el.querySelector?.(`[data-blank-id="${current.blankId}"]`) == null,
      );
      if (!target) {
        finish(
          {
            sourceBlankId: current.blankId,
            rejected: true,
            reason: "no thread node under cursor",
          },
          "rejected",
        );
        return;
      }
      const targetNodeId = target.dataset.id ?? "";
      // ThreadView's nodes are id'd by the thread-node id (e.g. "tn-3"),
      // not the IR id. The IR id is surfaced as a data attribute on the
      // node's inner content; if present, surface it too so M16.3 can
      // skip a re-lookup.
      const inner = target.querySelector<HTMLElement>("[data-ir-node-id]");
      const targetIrNodeId = inner?.dataset.irNodeId ?? null;
      finish(
        {
          sourceBlankId: current.blankId,
          targetNodeId,
          targetIrNodeId,
          rejected: false,
        },
        "linked",
      );
    };

    const onCancel = () => {
      finish(
        {
          sourceBlankId: state.blankId,
          rejected: true,
          reason: "pointer cancelled",
        },
        "rejected",
      );
    };

    // Document-level so the drag survives leaving the canvas, hitting
    // the side panel, etc.
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    };
  }, [state]);

  if (!state) return null;

  // Render a screen-fixed SVG overlay with a single line from the
  // handle origin to the current cursor. Pointer-events: none so it
  // never absorbs the pointerup that ends the drag.
  const { origin, cursor } = state;
  return (
    <svg
      data-thread-linker-overlay="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 50,
      }}
      width="100%"
      height="100%"
    >
      <line
        x1={origin.x}
        y1={origin.y}
        x2={cursor.x}
        y2={cursor.y}
        stroke="var(--accent-thread)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        strokeLinecap="round"
        style={{
          filter:
            "drop-shadow(0 0 6px color-mix(in oklab, var(--accent-thread) 55%, transparent))",
        }}
      />
      <circle
        cx={cursor.x}
        cy={cursor.y}
        r={4}
        fill="var(--accent-thread)"
        style={{
          filter:
            "drop-shadow(0 0 6px color-mix(in oklab, var(--accent-thread) 60%, transparent))",
        }}
      />
    </svg>
  );
}
