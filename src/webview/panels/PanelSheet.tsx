// The one frame every panel opens in (GUI brief M3): a centred, near-square
// sheet over a dimmed canvas, in the app's own surface colour (2026-10-08: no
// per-panel tint — the title and icon say which panel it is), with a
// switcher row so moving between panels never closes and reopens. "Dock"
// keeps the old side-drawer placement for a person who wants the graph in
// view (remembered per browser). Esc closes.
//
// The panels stay mounted where App has always mounted them (the board
// must hear a pin while closed) and render their body into this sheet's
// slots through SheetPortal.

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, PanelRight, Maximize2, Shapes } from "lucide-react";
import { KindLegend } from "./Chip";
import { PANELS, panelSpec, type PanelId } from "./panels";

export interface SheetSlot { body: HTMLElement; sub: HTMLElement }

const DOCK_KEY = "vg-sheet-docked";
const readDocked = () => { try { return localStorage.getItem(DOCK_KEY) === "1"; } catch { return false; } };

export function PanelSheet({ active, available, badges, onSwitch, onClose, onSlot, dock = false }: {
  active: PanelId;
  available: readonly PanelId[];
  badges?: Partial<Record<PanelId, number>>;
  onSwitch: (id: PanelId) => void;
  onClose: () => void;
  onSlot: (slot: SheetSlot | null) => void;
  /** open docked this time (not remembered): the board opened by a pin,
   *  where the person is still working the graph */
  dock?: boolean;
}) {
  const spec = panelSpec(active);
  const [docked, setDocked] = useState(() => dock || readDocked());
  useEffect(() => { if (dock) setDocked(true); }, [dock]);
  const [key, setKey] = useState(false);
  const body = useRef<HTMLDivElement | null>(null);
  const sub = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (body.current && sub.current) onSlot({ body: body.current, sub: sub.current });
    return () => onSlot(null);
  }, [onSlot]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const toggleDock = () => {
    const next = !docked;
    setDocked(next);
    try { localStorage.setItem(DOCK_KEY, next ? "1" : "0"); } catch { /* not remembered */ }
  };
  const Icon = spec.icon;
  return (
    <>
      {!docked && <div className="vg-sheet-scrim" data-sheet-scrim onClick={onClose} />}
      <section
        className="vg-sheet" role="dialog" aria-modal={!docked} aria-label={spec.title}
        data-panel-sheet={active} data-docked={docked ? "true" : undefined}
      >
        <header className="vg-sheet-head">
          <Icon size={16} strokeWidth={1.5} aria-hidden />
          <b>{spec.title}</b>
          <span className="vg-sheet-sub" data-sheet-subtitle ref={sub} />
          <span className="vg-grow" />
          <button type="button" className="vg-sheet-btn" data-sheet-key aria-pressed={key} onClick={() => setKey(!key)}
            title="What each colour and icon stands for">
            <Shapes size={16} strokeWidth={1.5} /> Key
          </button>
          <button type="button" className="vg-sheet-btn" data-sheet-dock onClick={toggleDock}
            title={docked ? "Centre the panel over the graph" : "Dock the panel at the side, the graph stays in view"}>
            {docked ? <Maximize2 size={16} strokeWidth={1.5} /> : <PanelRight size={16} strokeWidth={1.5} />}
          </button>
          <button type="button" className="vg-sheet-btn" data-sheet-close onClick={onClose} aria-label={`Close ${spec.title}`}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        <nav className="vg-switcher" role="tablist" aria-label="Panels">
          {PANELS.filter((p) => available.includes(p.id)).map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={p.id === active} data-sheet-tab={p.id}
              onClick={() => onSwitch(p.id)}>
              {p.title}
              {badges?.[p.id] ? <span className="vg-badge" data-sheet-badge={p.id}>· {badges[p.id]}</span> : null}
            </button>
          ))}
        </nav>
        {key && <div data-sheet-legend style={{ padding: "12px 20px", borderBottom: "1px solid var(--border-edge)", maxHeight: 220, overflow: "auto" }}><KindLegend /></div>}
        <div ref={body} data-sheet-slot style={{ minHeight: 0, flex: 1, display: "grid" }} />
      </section>
    </>
  );
}

/** A panel's body (and the subtitle it states) rendered into the sheet. */
export function SheetPortal({ slot, subtitle, children }: { slot: SheetSlot; subtitle?: string; children: React.ReactNode }) {
  return (
    <>
      {createPortal(children, slot.body)}
      {subtitle ? createPortal(subtitle, slot.sub) : null}
    </>
  );
}

/** The inside of a sheet: a navigation column (sections with counts) beside
 *  a scrolling content column; without `nav`, the content takes the width.
 *  Without `onNav`, a nav item scrolls to the element marked
 *  `data-sheet-section={id}` in the content (jump links). */
export function SheetBody<T extends string>({ nav, active, onNav, children }: {
  nav?: Array<{ id: T; label: string; count?: number }>;
  active?: T;
  onNav?: (id: T) => void;
  children: React.ReactNode;
}) {
  const [jumped, setJumped] = useState<T | undefined>(undefined);
  const content = useRef<HTMLDivElement | null>(null);
  const current = active ?? jumped ?? nav?.[0]?.id;
  const go = (id: T) => {
    if (onNav) { onNav(id); return; }
    setJumped(id);
    content.current?.querySelector(`[data-sheet-section="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
  };
  return (
    <div className="vg-sheet-body" data-nav={nav?.length ? undefined : "none"}>
      {nav?.length ? (
        <div className="vg-sheet-nav" role="navigation" data-sheet-nav>
          {nav.map((n) => (
            <button key={n.id} type="button" aria-current={n.id === current} data-sheet-nav-item={n.id} onClick={() => go(n.id)}>
              {n.label}{n.count !== undefined && <i>{n.count}</i>}
            </button>
          ))}
        </div>
      ) : null}
      <div className="vg-sheet-content" data-sheet-content ref={content}>{children}</div>
    </div>
  );
}
