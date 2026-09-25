// A dispatcher's allow-list in the architecture inspector: the scripts its
// own file names and runs (ArchNodeRecord.dispatches, read from its command
// hops), one collapsible section per directory, each script opening its
// thread. The files that name the dispatcher follow, collapsed. "Download"
// saves the list as Markdown: the same facts, for a README or a ticket.

import React from "react";
import { Download } from "lucide-react";
import type { ArchNodeRecord } from "../../shared/protocol";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)" };
const baseName = (f: string) => f.slice(f.lastIndexOf("/") + 1);

/** The list as Markdown, grouped as drawn. */
export function dispatchMarkdown(n: ArchNodeRecord): string {
  const d = n.dispatches ?? [];
  const total = d.reduce((k, g) => k + g.scripts.length, 0);
  const lines = [`# ${n.label}`, "", `Dispatcher: runs ${total} scripts from ${d.length} director${d.length === 1 ? "y" : "ies"}; named by ${n.callers?.length ?? 0} files.`, ""];
  for (const g of d) {
    lines.push(`## ${g.dir}/`, "");
    for (const s of g.scripts) lines.push(`- \`${s.file}\``);
    lines.push("");
  }
  if (n.callers?.length) {
    lines.push("## Named by", "");
    for (const c of n.callers) lines.push(`- \`${c}\``);
    lines.push("");
  }
  lines.push("Read from the command hops in VibeGraph's IR (the dispatcher's own file names each script).");
  return lines.join("\n") + "\n";
}

function download(n: ArchNodeRecord) {
  const blob = new Blob([dispatchMarkdown(n)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${n.label.replace(/\.[^.]+$/, "")}-dispatch.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ArchDispatchList({ node, onOpenThread }: { node: ArchNodeRecord; onOpenThread?: (entryPointId: string) => void }) {
  const d = node.dispatches ?? [];
  const total = d.reduce((k, g) => k + g.scripts.length, 0);
  // Few directories open; many start folded so the panel stays a summary.
  const openAll = d.length <= 3;
  return (
    <div data-arch-dispatch style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, color: "var(--text-primary)" }}>{`dispatches ${total} scripts`}</div>
        <button data-arch-dispatch-download onClick={() => download(node)} title="Download this list as Markdown"
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "1px solid var(--border-edge)", borderRadius: 4, padding: "2px 8px", color: "var(--text-secondary)", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)" }}>
          <Download size={14} strokeWidth={1.5} />Download
        </button>
      </div>
      {d.map((g) => (
        <details key={g.dir} data-arch-dispatch-dir={g.dir} open={openAll}>
          <summary style={{ ...mono, cursor: "pointer", color: "var(--text-secondary)", padding: "2px 0" }}>{`${g.dir}/ (${g.scripts.length})`}</summary>
          {g.scripts.map((s) => (
            <button key={s.entryPointId} data-arch-dispatch-script={s.entryPointId} onClick={() => onOpenThread?.(s.entryPointId)}
              title={`${s.file}: open this script's thread`}
              style={{ ...mono, display: "block", background: "none", border: "none", padding: "2px 0 2px 16px", color: "var(--accent-thread)", cursor: "pointer", textAlign: "left", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {baseName(s.file)}
            </button>
          ))}
        </details>
      ))}
      {(node.callers?.length ?? 0) > 0 && (
        <details data-arch-dispatch-callers style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", color: "var(--text-primary)" }}>{`named by ${node.callers!.length} files`}</summary>
          {node.callers!.map((c) => <div key={c} style={{ ...mono, color: "var(--text-muted)", padding: "2px 0 2px 16px", overflowWrap: "anywhere" }}>{c}</div>)}
        </details>
      )}
    </div>
  );
}
