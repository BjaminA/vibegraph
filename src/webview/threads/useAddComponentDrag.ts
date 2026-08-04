// M12 Merge A — drag-from-toolbar-onto-call-node state machine.
//
// Lives in App.tsx (only one drag in flight at a time). Owns:
//   * which AddKind the user picked from the toolbar popover
//   * the live cursor position so the ghost can follow
//   * cancellation on Escape / right-click / off-canvas
//   * the drop event itself — fired when the user mouseups over a
//     thread node that opted in by listening for `vg-add-component-drop`
//
// ThreadNode opts into drop targeting by reading `document.body.dataset
// .addComponentDragging` (set true while dragging) and dispatching a
// `vg-add-component-drop` CustomEvent on its own root when mouseup fires
// inside it. The hook listens for that event and resolves the drop into
// a state transition.
//
// State machine:
//   idle → picking-kind  (user clicked toolbar +)
//   picking-kind → dragging  (user picked a kind from the popover)
//   picking-kind → idle      (user closed the popover or hit Escape)
//   dragging → dropped       (user mouseupped over a thread node)
//   dragging → idle          (Escape / right-click / off-canvas mouseup)
//   dropped → idle           (modal submit or cancel)

import { useCallback, useEffect, useRef, useState } from "react";

export type AddKind =
  | "call"
  | "function_def"
  | "class_def"
  | "assignment"
  | "if_stmt"
  | "for_loop"
  | "while_loop"
  | "return_stmt"
  | "raise_stmt"
  // M12.2: PLAN-v3.md §2's tenth entry. The state machine treats it
  // identically to a statement kind (idle → picking-kind → dragging →
  // dropped); M12.5 will branch on this kind to open a different modal
  // (description input → Claude proposal) instead of the template modal.
  | "describe";

export type AddComponentDragMode = "idle" | "picking-kind" | "dragging" | "dropped";

export interface AddComponentDropDetail {
  targetNodeId: string;
  targetIrNodeId: string | null;
  targetFile: string | null;
  targetKind: string;        // ThreadNode's `kind` (seed / step / external / ...)
  irType: string | null;     // IR node type ("call", "function_def", ...)
  // M12.3 — modifier keys held at drop time. PLAN-v3.md §4.2:
  // alt forces the insertion-point picker open; shift forces "before";
  // ctrl / cmd (meta) force "after". The drag hook fills these from
  // the mouseup MouseEvent — node-level dispatchers leave them as
  // false (applyModifierOverride treats absent as no-op).
  modifiers?: {
    alt: boolean;
    shift: boolean;
    ctrl: boolean;
    meta: boolean;
  };
}

export interface AddComponentDragState {
  mode: AddComponentDragMode;
  kind: AddKind | null;
  cursor: { x: number; y: number } | null;
  drop: AddComponentDropDetail | null;
}

export interface AddComponentDragApi {
  state: AddComponentDragState;
  openKindPicker: () => void;
  pickKind: (kind: AddKind) => void;
  closeKindPicker: () => void;
  closeModal: () => void;
}

const INITIAL: AddComponentDragState = { mode: "idle", kind: null, cursor: null, drop: null };

export function useAddComponentDrag(): AddComponentDragApi {
  const [state, setState] = useState<AddComponentDragState>(INITIAL);
  // Ref mirror so the global event handlers (mousemove / keydown) don't
  // capture stale closure values across renders.
  const stateRef = useRef(state);
  stateRef.current = state;

  const reset = useCallback(() => setState(INITIAL), []);

  const openKindPicker = useCallback(() => {
    setState({ mode: "picking-kind", kind: null, cursor: null, drop: null });
  }, []);

  const closeKindPicker = useCallback(() => {
    if (stateRef.current.mode === "picking-kind") reset();
  }, [reset]);

  const pickKind = useCallback((kind: AddKind) => {
    setState({ mode: "dragging", kind, cursor: null, drop: null });
  }, []);

  const closeModal = useCallback(() => {
    if (stateRef.current.mode === "dropped") reset();
  }, [reset]);

  // Side-effect glue. Runs while we're past the picking-kind stage.
  useEffect(() => {
    if (state.mode !== "dragging") return;

    const onMouseMove = (e: MouseEvent) => {
      setState((prev) => prev.mode === "dragging" ? { ...prev, cursor: { x: e.clientX, y: e.clientY } } : prev);
    };

    // Off-canvas pointerup (window-level) means the user released outside any
    // thread/diagram node. ThreadNode / DiagramCanvas dispatch
    // vg-add-component-drop *before* this fires when the release happens on
    // them, so we can safely treat plain pointerup as a cancel signal.
    //
    // M12 diag fix: pointerup, not mouseup. React Flow's setPointerCapture
    // on node pointerdown suppresses compatibility mouseup events per the
    // W3C pointer-events spec. The window-level mouseup never fires when
    // the user is on a react-flow node — which broke the cancel logic too.
    const onPointerUp = () => {
      // Defer to next tick so any in-flight drop event handler wins the race.
      setTimeout(() => {
        if (stateRef.current.mode === "dragging") reset();
      }, 0);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") reset();
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      reset();
    };

    const onDrop = (e: Event) => {
      const detail = (e as CustomEvent<AddComponentDropDetail>).detail;
      if (!detail) return;
      setState((prev) => prev.mode === "dragging"
        ? { ...prev, mode: "dropped", drop: detail }
        : prev);
    };

    // Flag for ThreadNode to read via CSS selector / dataset.
    document.body.dataset.addComponentDragging = "true";

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("vg-add-component-drop", onDrop as EventListener);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("vg-add-component-drop", onDrop as EventListener);
      delete document.body.dataset.addComponentDragging;
    };
  }, [state.mode, reset]);

  // Escape from the picking-kind popover too.
  useEffect(() => {
    if (state.mode !== "picking-kind") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") reset();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.mode, reset]);

  return { state, openKindPicker, pickKind, closeKindPicker, closeModal };
}
