// Code-view insight (2026-09-28): reachability and configuration beside the
// source, from the envelope's `insight` (src/server/insight.ts).
//
//   unreached  a function no entry point reaches. DIMMED only for the reasons
//              that suggest dead code (never named / exported, never named /
//              called only from unreached code); the two "treat it as used"
//              reasons get the hover and no dimming — dimming used code would
//              be the lie the report exists to avoid.
//   env        a line that reads an environment variable: a dot in the glyph
//              margin, amber when the variable is declared nowhere.

import type { InsightRecord } from "../shared/protocol";

const REASON: Record<string, string> = {
  "never-named": "never named anywhere in the project — likely dead",
  "exported-never-named": "exported, but never named in the project — dead here, may be used from outside",
  "called-only-from-unreached": "called only from code that nothing reaches — dead with its caller",
  "named-not-linked": "its name is written somewhere the linker did not link — treat it as used",
  "walk-gap-nested": "a helper nested in a reached function the thread walk does not follow yet — treat it as reached",
};
const DIM = new Set(["never-named", "exported-never-named", "called-only-from-unreached"]);

export interface InsightDecoration { startLine: number; endLine: number; kind: "unreached-dim" | "unreached-note" | "env" | "env-undeclared"; text: string }

export function codeInsightFor(
  filePath: string | null,
  astNodes: ReadonlyArray<{ id: string; line?: number | null; endLine?: number | null }>,
  insight: InsightRecord | null | undefined,
): InsightDecoration[] {
  if (!filePath || !insight) return [];
  const out: InsightDecoration[] = [];
  const span = new Map(astNodes.map((n) => [n.id, n]));
  for (const u of insight.reachability.unreached) {
    if (u.file !== filePath) continue;
    const n = span.get(u.id);
    const start = n?.line ?? u.line;
    out.push({
      startLine: start,
      endLine: DIM.has(u.reason) ? (n?.endLine ?? start) : start,
      kind: DIM.has(u.reason) ? "unreached-dim" : "unreached-note",
      text: `**No entry point reaches \`${u.name}\`** — ${REASON[u.reason] ?? u.reason}. (reachability.md)`,
    });
  }
  const byLine = new Map<number, { names: string[]; undeclared: boolean }>();
  for (const v of insight.env?.vars ?? []) {
    for (const r of v.readers) {
      if (r.file !== filePath) continue;
      const cur = byLine.get(r.line) ?? { names: [], undeclared: false };
      if (!cur.names.includes(v.name)) cur.names.push(v.name);
      if (!v.declared && insight.env?.hasDeclarations) cur.undeclared = true;
      byLine.set(r.line, cur);
    }
  }
  for (const [line, v] of byLine) {
    out.push({
      startLine: line, endLine: line, kind: v.undeclared ? "env-undeclared" : "env",
      text: `**reads environment:** ${v.names.map((n) => {
        const d = insight.env?.vars.find((x) => x.name === n);
        return `\`${n}\`${d && !d.declared && insight.env?.hasDeclarations ? " (declared nowhere)" : ""}`;
      }).join(", ")}`,
    });
  }
  return out;
}

export function insightMonacoDecorations(
  monaco: { Range: new (a: number, b: number, c: number, d: number) => unknown },
  decos: InsightDecoration[],
): Array<{ range: unknown; options: Record<string, unknown> }> {
  return decos.map((d) => ({
    range: new monaco.Range(d.startLine, 1, d.endLine, 1),
    options: d.kind === "unreached-dim"
      ? { isWholeLine: true, inlineClassName: "vg-unreached-code", hoverMessage: { value: d.text } }
      : d.kind === "unreached-note"
        ? { isWholeLine: true, hoverMessage: { value: d.text } }
        : { isWholeLine: true, glyphMarginClassName: d.kind === "env-undeclared" ? "vg-env-glyph vg-env-glyph-undeclared" : "vg-env-glyph", glyphMarginHoverMessage: { value: d.text }, hoverMessage: { value: d.text } },
  }));
}
