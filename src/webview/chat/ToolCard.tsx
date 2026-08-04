// M-CHAT-POLISH.4 — the chat's tool activity card, extracted from
// ChatPanel (with M2's store extraction this brings ChatPanel back
// under the 500-line rule).
//
// A card reads in one second at rest: icon + tool name + a one-line
// argument summary (the Bash command, the file path, the pattern — not
// just the bare word "Bash"), and the M1 spinner→check lifecycle. The
// full input (pretty-printed args / whole command) and the result
// message are one click away behind the chevron — detail on demand,
// never in the way.
import React, { useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FilePenLine,
  FileText,
  Globe,
  Loader2,
  Pencil,
  RotateCw,
  Search,
  Settings,
  Terminal,
  Waypoints,
  X,
} from "lucide-react";
import type { ToolSegment } from "./chat_store";

const ICON_PROPS = { size: 16, strokeWidth: 1.5 } as const;

function iconFor(name: string): JSX.Element {
  // The five CST rewriter ops keep their M25 icons.
  const exact: Record<string, JSX.Element> = {
    replace_node: <Pencil {...ICON_PROPS} />,
    insert_statement_before: <ArrowUp {...ICON_PROPS} />,
    insert_statement_after: <ArrowDown {...ICON_PROPS} />,
    delete_node: <X {...ICON_PROPS} />,
    rename_symbol: <RotateCw {...ICON_PROPS} />,
    Bash: <Terminal {...ICON_PROPS} />,
    Read: <FileText {...ICON_PROPS} />,
    Edit: <FilePenLine {...ICON_PROPS} />,
    Write: <FilePenLine {...ICON_PROPS} />,
    NotebookEdit: <FilePenLine {...ICON_PROPS} />,
    Grep: <Search {...ICON_PROPS} />,
    Glob: <Search {...ICON_PROPS} />,
    WebFetch: <Globe {...ICON_PROPS} />,
    WebSearch: <Globe {...ICON_PROPS} />,
  };
  if (exact[name]) return exact[name];
  // Every vibegraph MCP tool (unprefixed by the backend) is graph work.
  if (name.startsWith("vibegraph_")) return <Waypoints {...ICON_PROPS} />;
  return <Settings {...ICON_PROPS} />;
}

/** One-line argument summary per tool — the first thing a human wants
 * to know ("which file?", "what command?"), never the whole payload. */
export function toolSummary(name: string, input: Record<string, unknown>): string | null {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const tail = (v: unknown) => {
    const str = s(v);
    return str ? str.split("/").pop() ?? str : null;
  };
  switch (name) {
    case "Bash":
      return s(input.command) ?? s(input.description);
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return tail(input.file_path ?? input.filePath ?? input.notebook_path);
    case "Grep":
      return s(input.pattern);
    case "Glob":
      return s(input.pattern) ?? s(input.path);
    case "WebFetch":
    case "WebSearch":
      return s(input.url) ?? s(input.query);
    case "rename_symbol":
      return input.oldName && input.newName ? `${input.oldName} → ${input.newName}` : null;
    default: {
      // CST ops + vibegraph tools all address a node/entry point.
      const nodeish = s(input.nodeId) ?? s(input.entryPointId) ?? s(input.anchorNodeId);
      if (nodeish) return nodeish.split("/").pop() ?? nodeish;
      return tail(input.file_path ?? input.filePath ?? input.path);
    }
  }
}

/** The expanded detail: the whole command verbatim for Bash, pretty
 * JSON for everything else. */
function fullInput(name: string, input: Record<string, unknown>): string {
  if (name === "Bash" && typeof input.command === "string") return input.command;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function ToolLabel({ name }: { name: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {iconFor(name)}
      {name.replace(/_/g, " ")}
    </span>
  );
}

export function ToolCard({ seg }: { seg: ToolSegment }) {
  const [expanded, setExpanded] = useState(false);
  const done = seg.success !== undefined;
  const ok = seg.success === true;
  const accent = done ? (ok ? "var(--accent-thread)" : "var(--accent-error)") : "var(--type-call)";
  const summary = toolSummary(seg.name, seg.input);
  const hasDetail = Object.keys(seg.input ?? {}).length > 0 || !!seg.message;

  return (
    <div
      data-chat-tool
      data-state={!done ? "running" : ok ? "ok" : "error"}
      style={{
        margin: "4px 0",
        padding: "6px 10px",
        background: `color-mix(in oklab, ${accent} 5%, transparent)`,
        border: `1px solid color-mix(in oklab, ${accent} 20%, transparent)`,
        borderRadius: 6,
        fontSize: 11,
        fontFamily: "monospace",
        color: accent,
      }}
    >
      <div
        data-chat-tool-expand
        onClick={hasDetail ? () => setExpanded((e) => !e) : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: hasDetail ? "pointer" : "default",
        }}
        title={hasDetail ? (expanded ? "Hide the full input" : "Show what Claude ran") : undefined}
      >
        {hasDetail &&
          (expanded ? (
            <ChevronDown size={14} strokeWidth={1.5} style={{ flexShrink: 0, opacity: 0.7 }} />
          ) : (
            <ChevronRight size={14} strokeWidth={1.5} style={{ flexShrink: 0, opacity: 0.7 }} />
          ))}
        <span style={{ fontWeight: 700, flexShrink: 0 }}>
          <ToolLabel name={seg.name} />
        </span>
        {summary && (
          <span
            data-chat-tool-summary
            style={{
              opacity: 0.7,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
            title={summary}
          >
            {summary}
          </span>
        )}
        <span
          style={{
            marginLeft: "auto",
            opacity: done ? 1 : 0.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          {!done ? (
            <Loader2 size={16} strokeWidth={1.5} className="vg-spin" />
          ) : ok ? (
            <span className="vg-tool-settle" style={{ display: "inline-flex" }}>
              <Check size={16} strokeWidth={1.5} />
            </span>
          ) : (
            <span className="vg-tool-settle" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <AlertCircle size={16} strokeWidth={1.5} />
              {seg.message ?? "failed"}
            </span>
          )}
        </span>
      </div>

      {expanded && (
        <div data-chat-tool-detail style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          <pre
            className="vg-code-wrap"
            style={{
              margin: 0,
              padding: 8,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-edge)",
              borderRadius: 6,
              background: "color-mix(in oklab, var(--bg-canvas) 60%, transparent)",
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {fullInput(seg.name, seg.input)}
          </pre>
          {seg.message && ok && (
            <pre
              className="vg-code-wrap"
              style={{
                margin: 0,
                padding: 8,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-edge)",
                borderRadius: 6,
                maxHeight: 120,
                overflowY: "auto",
              }}
            >
              {seg.message}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
