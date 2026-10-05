// One component for every reference to a code object (GUI brief M2): a
// monospace rounded rectangle, the kind's icon and the label, its colours
// from the kind's row in KINDS. Clicking asks the app to focus the object
// (a `vg-focus` event, handled in focusRouter.ts); hovering shows its id.
//
// The brief drew each kind as a Unicode glyph; this project draws icons
// with lucide only (CLAUDE.md, the Aesthetic Appendix), so each kind has a
// lucide icon instead. Hue is never the only signal: icon + dashed border.

import React from "react";
import {
  Play, SquareFunction, Package, Database, FileText, Diamond, Braces, CodeXml,
  Fingerprint, Settings2, ArrowLeftRight, Scale, CircleHelp, type LucideIcon,
} from "lucide-react";
import { KINDS, VERDICT_STYLE, type ChipRef, type KindId } from "../../shared/kinds";

export const KIND_ICON: Record<KindId, LucideIcon> = {
  process: Play, function: SquareFunction, module: Package, store: Database, zone: Database,
  path: FileText, type: Diamond, json: Braces, xml: CodeXml, identity: Fingerprint,
  config: Settings2, external: ArrowLeftRight, rule: Scale, question: CircleHelp,
};

export interface FocusRequest { kind: KindId; id: string; at?: string }
export const FOCUS_EVENT = "vg-focus";

export function requestFocus(r: FocusRequest): void {
  window.dispatchEvent(new CustomEvent<FocusRequest>(FOCUS_EVENT, { detail: r }));
}

export function Chip({ kind, id, label, at, focusable = true }: ChipRef & { focusable?: boolean }) {
  const k = KINDS[kind];
  const Icon = KIND_ICON[kind];
  const style = { "--h": k.hue, "--s": `${k.sat}%` } as React.CSSProperties;
  const go = () => requestFocus({ kind, id, ...(at ? { at } : {}) });
  return (
    <span
      className="vg-chip"
      data-chip={kind}
      data-chip-ref={id}
      data-dashed={k.dashed ? "true" : undefined}
      style={style}
      title={`${k.label}: ${id}`}
      {...(focusable ? {
        role: "button", tabIndex: 0, onClick: go,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } },
      } : {})}
    >
      <Icon size={12} strokeWidth={1.5} aria-hidden />
      {label ?? id}
    </span>
  );
}

/** A judgement about an object: a pill with a dot, never a chip. With
 *  `onClick` it is a filter toggle (the plan's scorecard). */
export function Verdict({ v, label, onClick, pressed }: { v: string; label?: string; onClick?: () => void; pressed?: boolean }) {
  const s = VERDICT_STYLE[v] ?? VERDICT_STYLE.unverifiable;
  const style = { "--h": s.hue, "--s": `${s.sat}%` } as React.CSSProperties;
  const text = label ?? s.label ?? v;
  return onClick
    ? <button type="button" className="vg-verdict" data-verdict={v} data-dashed={s.dashed ? "true" : undefined} style={style} onClick={onClick} aria-pressed={!!pressed}>{text}</button>
    : <span className="vg-verdict" data-verdict={v} data-dashed={s.dashed ? "true" : undefined} style={style}>{text}</span>;
}

/** A bullet's parts: chips and the short verbs between them. */
export function Parts({ parts }: { parts: Array<ChipRef | string> }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === "string"
        ? <React.Fragment key={i}>{` ${p} `}</React.Fragment>
        : <React.Fragment key={i}>{i ? " " : ""}<Chip {...p} /></React.Fragment>))}
    </>
  );
}

/** The key: every kind with its chip and what it covers. */
export function KindLegend() {
  return (
    <div data-kind-legend style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "8px 16px" }}>
      {(Object.keys(KINDS) as KindId[]).map((k) => (
        <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-secondary)", fontSize: "var(--fs-12)" }}>
          <Chip kind={k} id={k} label={KINDS[k].label} focusable={false} />
          <span>{KINDS[k].covers}</span>
        </div>
      ))}
    </div>
  );
}
