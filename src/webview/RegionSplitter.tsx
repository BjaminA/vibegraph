// The line between the code panels and the Claude chat docked beneath them
// (2026-10-20, Ben: "enable the Claude chat view to be rescaled relative in
// the window, moving this up and down"). Drag it, or focus it and use the
// arrow keys (Home / End for the extremes); the height is remembered. The
// panels above follow through their dock's `bottom`, and Monaco re-lays out
// on its own (automaticLayout).

import React, { useCallback, useEffect, useState } from "react";

const KEY = "vg-node-chat-h";
export const CHAT_H_DEFAULT = 300;
export const CHAT_H_MIN = 120;
/** what the code above keeps: its header, a few lines and its footer */
const CODE_MIN = 220;
const STEP = 24;

export function clampChatHeight(h: number, viewport: number): number {
  return Math.round(Math.max(CHAT_H_MIN, Math.min(h, Math.max(CHAT_H_MIN, viewport - CODE_MIN))));
}

/** The docked chat's height, remembered across sessions and kept inside the window. */
export function useChatHeight(): { height: number; resize: (h: number) => void; commit: () => void } {
  const [height, setHeight] = useState<number>(() => {
    let h = CHAT_H_DEFAULT;
    try { const v = Number(localStorage.getItem(KEY)); if (Number.isFinite(v) && v > 0) h = v; } catch { /* ignore */ }
    return clampChatHeight(h, typeof window === "undefined" ? 1000 : window.innerHeight);
  });
  const resize = useCallback((h: number) => setHeight(clampChatHeight(h, window.innerHeight)), []);
  const commit = useCallback(() => {
    setHeight((h) => { try { localStorage.setItem(KEY, String(h)); } catch { /* ignore */ } return h; });
  }, []);
  useEffect(() => {
    const onWin = () => setHeight((h) => clampChatHeight(h, window.innerHeight));
    window.addEventListener("resize", onWin);
    return () => window.removeEventListener("resize", onWin);
  }, []);
  return { height, resize, commit };
}

export function RegionSplitter(props: { height: number; width: string; onResize: (h: number) => void; onCommit: () => void }) {
  const [hot, setHot] = useState(false);
  const [dragging, setDragging] = useState(false);
  const lit = hot || dragging;
  return (
    <div
      data-chat-splitter
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the chat"
      aria-valuenow={props.height}
      aria-valuemin={CHAT_H_MIN}
      tabIndex={0}
      title="Drag to resize the chat (or use the arrow keys)"
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
      onPointerMove={(e) => { if (dragging) props.onResize(window.innerHeight - e.clientY); }}
      onPointerUp={(e) => { if (!dragging) return; e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); props.onCommit(); }}
      onKeyDown={(e) => {
        const to = e.key === "ArrowUp" ? props.height + STEP : e.key === "ArrowDown" ? props.height - STEP
          : e.key === "Home" ? Number.MAX_SAFE_INTEGER : e.key === "End" ? 0 : null;
        if (to === null) return;
        e.preventDefault();
        e.stopPropagation();
        props.onResize(to);
        props.onCommit();
      }}
      style={{
        position: "fixed",
        right: 0,
        width: props.width,
        bottom: props.height - 4,
        height: 8,
        zIndex: 995, // above the docked panels (988–990) and the chat, under the toolbar (1010)
        cursor: "row-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        touchAction: "none",
        outline: "none",
      }}
    >
      <div style={{
        width: "100%", height: lit ? 2 : 1,
        background: lit ? "var(--text-muted)" : "var(--border-edge)",
        transition: "background 120ms, height 120ms",
      }} />
      <div aria-hidden style={{
        position: "absolute", width: 32, height: 4, borderRadius: 2,
        background: lit ? "var(--text-secondary)" : "var(--border-edge)",
        transition: "background 120ms",
      }} />
    </div>
  );
}
