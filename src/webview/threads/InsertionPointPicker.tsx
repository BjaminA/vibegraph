// M12.3 — floating insertion-point picker per PLAN-v3.md §4.1.
//
// Appears at the drop site when resolveInsertionPoint returns
// { kind: "ambiguous", ... } — i.e. when a statement-kind dropped on a
// non-body target could land before OR after, or when the user held
// Alt during drop. Four buttons, default-focused per defaultPoint,
// click commits to a single InsertionPoint that App.tsx forwards into
// M12.4's modal (in M12.3 it's logged).
//
// Hover preview line is owned by App.tsx — this component is a pure
// menu. Escape on the document cancels the entire drop (handled by
// useAddComponentDrag, not here).

import React, { useEffect, useRef } from "react";
import { ArrowUp, ArrowDown, ArrowDownToLine, ArrowUpFromLine, type LucideIcon } from "lucide-react";
import type { InsertionPoint } from "./insertionPoint";

interface Props {
  anchor: { x: number; y: number };
  options: InsertionPoint[];          // legal points from resolveInsertionPoint
  defaultPoint: InsertionPoint;       // initially-focused option
  reason: string;                     // surfaced as the picker subtitle
  onPick: (point: InsertionPoint) => void;
  onCancel: () => void;
}

interface OptionMeta {
  label: string;
  Icon: LucideIcon;
  hint: string;
}

const OPTION_META: Record<InsertionPoint, OptionMeta> = {
  before:     { label: "Before",     Icon: ArrowUp,         hint: "Above this node" },
  after:      { label: "After",      Icon: ArrowDown,       hint: "Below this node" },
  inside_top: { label: "Inside top", Icon: ArrowDownToLine, hint: "First child of this node's body" },
  inside_end: { label: "Inside end", Icon: ArrowUpFromLine, hint: "Last child of this node's body" },
};

export function InsertionPointPicker({
  anchor, options, defaultPoint, reason, onPick, onCancel,
}: Props) {
  const defaultBtnRef = useRef<HTMLButtonElement | null>(null);

  // Focus the default option on mount so Enter commits immediately.
  useEffect(() => {
    defaultBtnRef.current?.focus();
  }, []);

  // Clamp to viewport so the picker doesn't render off-screen for drops
  // near the right or bottom edges.
  const PICKER_W = 240;
  const PICKER_H = 24 + options.length * 36 + 32; // header + rows + footer
  const left = Math.max(8, Math.min(window.innerWidth - PICKER_W - 8, anchor.x + 12));
  const top = Math.max(8, Math.min(window.innerHeight - PICKER_H - 8, anchor.y + 12));

  return (
    <>
      {/* Backdrop swallows clicks outside the picker → cancel. */}
      <div
        onClick={onCancel}
        style={{ position: "fixed", inset: 0, zIndex: 1099 }}
      />
      <div
        role="menu"
        aria-label="Insertion point"
        style={{
          position: "fixed",
          left, top,
          width: PICKER_W,
          zIndex: 1100,
          background: "var(--bg-node)",
          border: "1px solid var(--border-edge)",
          borderRadius: 8,
          padding: 6,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-primary)",
          boxShadow: "var(--shadow-panel)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div
          style={{
            padding: "4px 8px 8px",
            color: "var(--text-muted)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            borderBottom: "1px solid var(--border-edge)",
            marginBottom: 4,
          }}
        >
          Insert where?
        </div>
        {options.map((point) => {
          const meta = OPTION_META[point];
          const isDefault = point === defaultPoint;
          return (
            <PickerRow
              key={point}
              btnRef={isDefault ? defaultBtnRef : undefined}
              Icon={meta.Icon}
              label={meta.label}
              hint={meta.hint}
              isDefault={isDefault}
              onClick={() => onPick(point)}
            />
          );
        })}
        <div
          title={reason}
          style={{
            padding: "6px 8px 2px",
            color: "var(--text-muted)",
            fontSize: 10,
            borderTop: "1px solid var(--border-edge)",
            marginTop: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {reason}
        </div>
      </div>
    </>
  );
}

function PickerRow({
  btnRef, Icon, label, hint, isDefault, onClick,
}: {
  btnRef?: React.Ref<HTMLButtonElement>;
  Icon: LucideIcon;
  label: string;
  hint: string;
  isDefault: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const active = hover || isDefault;
  return (
    <button
      ref={btnRef}
      type="button"
      role="menuitem"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      title={hint}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 5,
        background: active
          ? "color-mix(in oklab, var(--accent-thread) 14%, transparent)"
          : "transparent",
        border: `1px solid ${active
          ? "color-mix(in oklab, var(--accent-thread) 38%, transparent)"
          : "transparent"}`,
        color: "var(--text-primary)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "inherit",
        outline: "none",
        textAlign: "left",
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      <Icon size={14} strokeWidth={1.5} style={{ color: "var(--accent-thread)" }} />
      <span style={{ flex: 1 }}>{label}</span>
      {isDefault && (
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>↵</span>
      )}
    </button>
  );
}
