import React from "react";

// Bespoke type-discriminator icons. Colours route through tokens.css —
// type-float, type-list, type-dict, type-tuple, type-set, type-call provide
// per-Python-type identity; --accent-warning covers strings and f-strings;
// --accent-thread is the function/class/import accent. SVG fills accept
// var() and color-mix() the same way HTML CSS does.

// ── type value icons ─────────────────────────────────────────────────

export function NumberIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="9.5" fill="color-mix(in oklab, var(--type-float) 18%, transparent)" stroke="var(--type-float)" strokeWidth="1.5"/>
      {/* Phase 5: dropped the redundant "float" subtitle — the "1.0" glyph
          and the colour-coded ring already identify the kind. */}
      <text x="4" y="15" fill="var(--type-float)" fontSize="9" fontWeight="800" fontFamily="monospace">1.0</text>
    </svg>
  );
}

export function StringIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="4" width="18" height="13" rx="3" fill="color-mix(in oklab, var(--accent-warning) 15%, transparent)" stroke="var(--accent-warning)" strokeWidth="1.5"/>
      <text x="5" y="14" fill="var(--accent-warning)" fontSize="13" fontWeight="900" fontFamily="serif" letterSpacing="-1">"A"</text>
    </svg>
  );
}

export function FStringIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="4" width="18" height="13" rx="3" fill="color-mix(in oklab, var(--accent-warning) 15%, transparent)" stroke="var(--accent-warning)" strokeWidth="1.5"/>
      <text x="3" y="14" fill="var(--accent-warning)" fontSize="8" fontWeight="900" fontFamily="monospace">f"</text>
      {/* lightning bolt for dynamic */}
      <path d="M13 6 L10 11 L13 11 L10 17 L15 10 L12 10 Z" fill="var(--accent-warning)" opacity="0.9"/>
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="2" width="18" height="18" rx="3" fill="color-mix(in oklab, var(--type-list) 10%, transparent)" stroke="var(--type-list)" strokeWidth="1.5"/>
      <text x="3" y="9" fill="var(--type-list)" fontSize="8" fontWeight="800" fontFamily="monospace">[</text>
      <line x1="8" y1="7" x2="18" y2="7" stroke="var(--type-list)" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="8" y1="11" x2="18" y2="11" stroke="var(--type-list)" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="8" y1="15" x2="15" y2="15" stroke="var(--type-list)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
      <text x="18" y="19" fill="var(--type-list)" fontSize="8" fontWeight="800" fontFamily="monospace">]</text>
    </svg>
  );
}

export function DictIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="2" width="18" height="18" rx="3" fill="color-mix(in oklab, var(--type-dict) 12%, transparent)" stroke="var(--type-dict)" strokeWidth="1.5"/>
      <text x="3" y="12" fill="var(--type-dict)" fontSize="9" fontWeight="800" fontFamily="monospace">{"{"}</text>
      <text x="8" y="9" fill="var(--type-dict)" fontSize="6" fontFamily="monospace">k:</text>
      <line x1="14" y1="8" x2="19" y2="8" stroke="var(--type-dict)" strokeWidth="1" strokeLinecap="round"/>
      <text x="8" y="15" fill="var(--type-dict)" fontSize="6" fontFamily="monospace">k:</text>
      <line x1="14" y1="14" x2="17" y2="14" stroke="var(--type-dict)" strokeWidth="1" strokeLinecap="round" opacity="0.6"/>
      <text x="18" y="19" fill="var(--type-dict)" fontSize="9" fontWeight="800" fontFamily="monospace">{"}"}</text>
    </svg>
  );
}

export function TupleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <text x="2" y="14" fill="var(--type-tuple)" fontSize="12" fontWeight="800" fontFamily="monospace">(</text>
      <circle cx="10" cy="11" r="2" fill="var(--type-tuple)"/>
      <circle cx="15" cy="11" r="2" fill="var(--type-tuple)" opacity="0.7"/>
      <text x="17" y="14" fill="var(--type-tuple)" fontSize="12" fontWeight="800" fontFamily="monospace">)</text>
    </svg>
  );
}

export function SetIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="9" fill="color-mix(in oklab, var(--type-set) 10%, transparent)" stroke="var(--type-set)" strokeWidth="1.5"/>
      <circle cx="8" cy="9" r="2" fill="var(--type-set)"/>
      <circle cx="14" cy="9" r="2" fill="var(--type-set)" opacity="0.8"/>
      <circle cx="11" cy="14" r="2" fill="var(--type-set)" opacity="0.6"/>
    </svg>
  );
}

export function CallValueIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <text x="2" y="14" fill="var(--type-call)" fontSize="13" fontWeight="900" fontFamily="monospace">(</text>
      <path d="M10 8 L13 11 L10 14" stroke="var(--type-call)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <text x="16" y="14" fill="var(--type-call)" fontSize="13" fontWeight="900" fontFamily="monospace">)</text>
    </svg>
  );
}

export function OtherValueIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="9" fill="color-mix(in oklab, var(--text-secondary) 10%, transparent)" stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="3 2"/>
      <circle cx="7" cy="11" r="1.5" fill="var(--text-secondary)"/>
      <circle cx="11" cy="11" r="1.5" fill="var(--text-secondary)"/>
      <circle cx="15" cy="11" r="1.5" fill="var(--text-secondary)"/>
    </svg>
  );
}

// ── function icon ─────────────────────────────────────────────────────

export function FunctionIcon({ size = 28, color = "var(--accent-thread)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      {/* italic ƒ glyph */}
      <text
        x="14" y="21"
        textAnchor="middle"
        fill={color}
        fontSize="22"
        fontWeight="700"
        fontStyle="italic"
        fontFamily="Georgia, 'Times New Roman', serif"
      >
        ƒ
      </text>
    </svg>
  );
}

// ── class icon ────────────────────────────────────────────────────────

export function ClassIcon({ color = "var(--accent-thread)" }: { color?: string }) {
  // 13% / 9% fill tints derived from `${hex}22` / `${hex}18` (which were
  // hex-alpha suffixes equivalent to ~13.3% and ~9.4% opacity).
  const fillStrong = `color-mix(in oklab, ${color} 13%, transparent)`;
  const fillSoft = `color-mix(in oklab, ${color} 9%, transparent)`;
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      {/* top class diamond */}
      <rect x="9" y="1" width="8" height="8" rx="1"
        fill={fillStrong} stroke={color} strokeWidth="1.5"
        transform="rotate(45 13 5)"
      />
      {/* left member rect */}
      <rect x="1" y="17" width="10" height="7" rx="2"
        fill={fillSoft} stroke={color} strokeWidth="1.3"/>
      {/* right member rect */}
      <rect x="15" y="17" width="10" height="7" rx="2"
        fill={fillSoft} stroke={color} strokeWidth="1.3"/>
      {/* lines from diamond down */}
      <line x1="6" y1="10" x2="6" y2="17" stroke={color} strokeWidth="1.3"/>
      <line x1="20" y1="10" x2="20" y2="17" stroke={color} strokeWidth="1.3"/>
      <line x1="6" y1="10" x2="20" y2="10" stroke={color} strokeWidth="1.3"/>
      <line x1="13" y1="8" x2="13" y2="10" stroke={color} strokeWidth="1.3"/>
    </svg>
  );
}

// ── terminal / print icon ─────────────────────────────────────────────

export function TerminalIcon({ color = "var(--accent-io)" }: { color?: string }) {
  const fillTint = `color-mix(in oklab, ${color} 9%, transparent)`;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="1" y="3" width="22" height="18" rx="3"
        fill={fillTint} stroke={color} strokeWidth="1.5"/>
      {/* prompt > */}
      <path d="M5 9 L9 12 L5 15" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"/>
      {/* cursor _ */}
      <line x1="11" y1="15" x2="17" y2="15" stroke={color}
        strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

// ── package / import icon ─────────────────────────────────────────────

export function PackageIcon({ color = "var(--accent-thread)" }: { color?: string }) {
  const fillTint = `color-mix(in oklab, ${color} 8%, transparent)`;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* box body */}
      <path d="M2 6 L9 3 L16 6 L16 14 L9 17 L2 14 Z"
        fill={fillTint} stroke={color} strokeWidth="1.3" strokeLinejoin="round"/>
      {/* top face */}
      <path d="M2 6 L9 9 L16 6" stroke={color} strokeWidth="1.3"/>
      <line x1="9" y1="9" x2="9" y2="17" stroke={color} strokeWidth="1.3" opacity="0.6"/>
      {/* label stripe */}
      <line x1="5" y1="11" x2="8" y2="12" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" opacity="0.7"/>
    </svg>
  );
}

// ── return arrow ──────────────────────────────────────────────────────

export function ReturnArrow({ color = "var(--accent-thread)" }: { color?: string }) {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
      <line x1="0" y1="7" x2="14" y2="7" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <path d="M10 3 L16 7 L10 11" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

// ── port dot ──────────────────────────────────────────────────────────

export function PortDot({ color = "var(--accent-thread)", filled = true }: { color?: string; filled?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5"
        fill={filled ? color : "transparent"}
        stroke={color}
        strokeWidth="1.5"
      />
      {filled && <circle cx="6" cy="6" r="2.5" fill="var(--bg-canvas)"/>}
    </svg>
  );
}

// ── helper: pick icon by value kind ──────────────────────────────────

export function ValueKindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "scalar":  return <NumberIcon />;
    case "string":  return <StringIcon />;
    case "fstring": return <FStringIcon />;
    case "list":    return <ListIcon />;
    case "dict":    return <DictIcon />;
    case "tuple":   return <TupleIcon />;
    case "set":     return <SetIcon />;
    case "call":    return <CallValueIcon />;
    default:        return <OtherValueIcon />;
  }
}
