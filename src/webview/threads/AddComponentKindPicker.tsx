// M12.2 Merge B — kind-picker popover for the toolbar + button.
//
// Click `+ Add` → this opens beneath the toolbar; pick a kind → the
// popover closes and the drag ghost takes over (per
// useAddComponentDrag's pickKind transition).
//
// PLAN-v3.md §2: ten kinds, all enabled. Nine statement kinds plus
// "Describe…" (Sparkles) which routes through Claude (M12.5). Disabled
// state is reserved for per-context legality — e.g. dragging
// return_stmt in a module-scope view — and is computed by the drop
// logic, not statically here. M12.2 ships with everything enabled and
// per-context disabling lands in M12.3 with insertion-point inference.

import React from "react";
import {
  ChevronRight, Play, Box, Equal, GitBranch, Repeat, Infinity as InfinityIcon,
  ArrowRightToLine, AlertTriangle, Sparkles, type LucideIcon,
} from "lucide-react";
import type { AddKind } from "./useAddComponentDrag";

interface KindEntry {
  kind: AddKind;
  label: string;
  Icon: LucideIcon;
}

// Icon assignments per PLAN-v3.md §2:
//   for_loop  → Repeat   (was RotateCw in Merge A; swapped for visual
//                         distinguishability from while_loop)
//   while_loop → Infinity (figure-8, very distinct from Repeat at 16px)
//   describe   → Sparkles (Claude path; M12.5 will branch on this kind)
const KINDS: KindEntry[] = [
  { kind: "call",         label: "Call",        Icon: ChevronRight     },
  { kind: "function_def", label: "Function",    Icon: Play             },
  { kind: "class_def",    label: "Class",       Icon: Box              },
  { kind: "assignment",   label: "Assignment",  Icon: Equal            },
  { kind: "if_stmt",      label: "Branch",      Icon: GitBranch        },
  { kind: "for_loop",     label: "For loop",    Icon: Repeat           },
  { kind: "while_loop",   label: "While loop",  Icon: InfinityIcon     },
  { kind: "return_stmt",  label: "Return",      Icon: ArrowRightToLine },
  { kind: "raise_stmt",   label: "Raise",       Icon: AlertTriangle    },
  { kind: "describe",     label: "Describe…",   Icon: Sparkles         },
];

interface Props {
  anchor: { top: number; left: number };
  onPick: (kind: AddKind) => void;
  onClose: () => void;
}

export function AddComponentKindPicker({ anchor, onPick, onClose }: Props) {
  return (
    <>
      {/* Backdrop click-out to close. Invisible but covers viewport. */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 1019 }}
      />
      <div
        role="menu"
        style={{
          position: "fixed",
          top: anchor.top,
          left: anchor.left,
          zIndex: 1020,
          width: 260,
          padding: 6,
          background: "var(--bg-node)",
          border: "1px solid var(--border-edge)",
          borderRadius: 8,
          boxShadow: "var(--shadow-panel)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-primary)",
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 4,
        }}
      >
        <div
          style={{
            gridColumn: "1 / -1",
            padding: "4px 6px",
            color: "var(--text-muted)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Add component
        </div>
        {KINDS.map(({ kind, label, Icon }) => (
          <KindRow
            key={kind}
            label={label}
            Icon={Icon}
            onPick={() => onPick(kind)}
          />
        ))}
      </div>
    </>
  );
}

function KindRow({ label, Icon, onPick }: {
  label: string; Icon: LucideIcon; onPick: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
      title={`Drag to add a ${label.toLowerCase().replace(/…$/, "")}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 5,
        background: hover ? "color-mix(in oklab, var(--accent-thread) 12%, transparent)" : "transparent",
        border: `1px solid ${hover
          ? "color-mix(in oklab, var(--accent-thread) 30%, transparent)"
          : "transparent"}`,
        color: "var(--text-primary)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "inherit",
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      <Icon size={16} strokeWidth={1.5} style={{ color: "var(--accent-thread)" }} />
      <span>{label}</span>
    </button>
  );
}
