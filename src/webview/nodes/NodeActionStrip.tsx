import React, { useState } from "react";

interface Props {
  nodeId: string;
  accentColor: string;
  // M8.3.3: function-def nodes get an extra "pin as thread seed"
  // action that appends to .vibegraph/manual_seeds.json server-side
  // and re-runs discovery + extraction. Hidden elsewhere so a class
  // or assignment doesn't get an action that the extractor can't
  // honour.
  showPin?: boolean;
  // Sitting-2 — function-def nodes hide the expand chevron: for them the
  // NodeExpandedOverlay is a Gate-2 placeholder showing LESS than the card
  // (signature + "full source arrives with M5"), so next to "Edit source"
  // it read as a broken duplicate. Overlay stays mounted for other kinds
  // (park-don't-delete).
  showExpand?: boolean;
}

// M10-chat-removal: the "chat" action ("Modify with Claude") dispatched
// vg-chat-about-node into the now-unmounted ChatPanel. Plain-language
// edits live in NodeEditorPanel's Intent mode; the MCP path covers
// conversation.
type ActionId = "edit" | "expand" | "hide" | "pin";

const SIZE = 22;
const RADIUS = 5;

function actionIcon(id: ActionId): React.ReactElement {
  switch (id) {
    case "edit":
      return (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path d="M11.5 1.5L14.5 4.5L5 14L1 15L2 11L11.5 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "expand":
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M3 6L8 11L13 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "hide":
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M2 8C3.5 5 5.5 3.5 8 3.5C10.5 3.5 12.5 5 14 8C12.5 11 10.5 12.5 8 12.5C5.5 12.5 3.5 11 2 8Z" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "pin":
      // Lucide Pin glyph reduced to a 16x16 viewBox path.
      return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M5 1.5h6L9.5 5.5v3l3 2.5H3.5l3-2.5v-3L5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <line x1="8" y1="11" x2="8" y2="15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
  }
}

function tooltip(id: ActionId): string {
  switch (id) {
    case "edit": return "Edit source";
    case "expand": return "Expand node";
    case "hide": return "Hide this node";
    case "pin": return "Start a thread from here";
  }
}

function ActionButton({
  id,
  accentColor,
  onClick,
}: {
  id: ActionId;
  accentColor: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      title={tooltip(id)}
      style={{
        width: SIZE,
        height: SIZE,
        background: hover ? `${accentColor}33` : "transparent",
        border: `1px solid ${hover ? accentColor + "99" : accentColor + "44"}`,
        borderRadius: RADIUS,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: accentColor,
        padding: 0,
        opacity: hover ? 1 : 0.85,
        transition: "all 0.12s",
      }}
    >
      {actionIcon(id)}
    </button>
  );
}

export function NodeActionStrip({ nodeId, accentColor, showPin, showExpand = true }: Props) {
  const dispatch = (eventName: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent(eventName, { detail: { nodeId } }));
  };

  return (
    <div
      data-action-strip
      style={{
        position: "absolute",
        top: 5,
        right: 5,
        display: "flex",
        gap: 3,
        padding: "2px 3px",
        // Slightly opaquer surface than before -- hover-reveal means the
        // strip only ever appears when the user is looking at this node,
        // so we can afford a clearer glass treatment (was --bg-canvas 55%).
        background: "color-mix(in oklab, var(--bg-canvas) 78%, transparent)",
        borderRadius: 7,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 10,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ActionButton id="edit" accentColor={accentColor} onClick={dispatch("vg-edit-node")} />
      {showExpand && (
        <ActionButton id="expand" accentColor={accentColor} onClick={dispatch("vg-expand-node")} />
      )}
      <ActionButton id="hide" accentColor={accentColor} onClick={dispatch("vg-hide-node")} />
      {showPin && (
        <ActionButton id="pin" accentColor={accentColor} onClick={dispatch("vg-add-manual-seed")} />
      )}
    </div>
  );
}
