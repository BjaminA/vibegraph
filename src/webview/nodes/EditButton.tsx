import React, { useState } from "react";
import { Pencil } from "lucide-react";

interface Props {
  nodeId: string;
}

export function EditButton({ nodeId }: Props) {
  const [hover, setHover] = useState(false);

  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent("vg-edit-node", { detail: { nodeId } }));
      }}
      style={{
        position: "absolute",
        top: 5,
        right: 5,
        width: 18,
        height: 18,
        background: hover ? "color-mix(in oklab, var(--type-call) 25%, transparent)" : "transparent",
        border: `1px solid ${hover ? "color-mix(in oklab, var(--type-call) 60%, transparent)" : "color-mix(in oklab, var(--type-call) 20%, transparent)"}`,
        borderRadius: 3,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--type-call)",
        fontSize: 10,
        padding: 0,
        zIndex: 10,
        transition: "all 0.12s",
        opacity: hover ? 1 : 0.4,
        lineHeight: 1,
      }}
      title="Edit source"
    >
      <Pencil size={16} strokeWidth={1.5} />
    </button>
  );
}
