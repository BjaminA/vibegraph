// The data-flow report in words (moved out of dataflow.ts, 2026-10-17, when
// that file passed 500 lines): the thread contract's lines, each thread's
// findings, and security.md — grouped by FILE, because a field run's "to
// review" list was mostly the same four scripts met from different call
// sites, read top to bottom as thirteen separate problems.

import type { DataflowFinding, DataflowReport, SinkKind } from "./dataflow.ts";

const KIND_LABEL: Record<SinkKind, string> = {
  command: "reaches a shell command",
  argument: "reaches a command's argument list (no shell)",
  sql: "reaches SQL query text",
  code: "reaches code evaluation",
};

/** How a guard reads: a condition that names the value, or a guard-named call taking it. */
function guardWords(f: DataflowFinding, long: boolean): string {
  if (!f.guard) return "";
  if (f.guardKind === "call") return long ? `a check is called on it first: \`${f.guard}\` — verify it rejects what it should` : `; a check is called on it first: \`${f.guard}\``;
  return long ? `a condition mentions it on the way: \`${f.guard}\` — verify it actually validates` : `; a condition mentions it: \`${f.guard}\``;
}

/** A thread contract's lines: what untrusted input reaches on this thread,
 *  unguarded first, at most four named. Null when nothing does. */
export function formatUntrustedLines(findings: DataflowFinding[] | undefined): string | null {
  if (!findings?.length) return null;
  const shown = findings.slice(0, 4).map((f) =>
    `- [${f.severity === "high" ? "UNGUARDED" : "review"}] ${KIND_LABEL[f.kind]}: \`${f.sink.text.replace(/\s+/g, " ").slice(0, 90)}\` (${f.sink.file}${f.sink.line ? `:${f.sink.line}` : ""}) from ${f.source.what}${guardWords(f, false)}`);
  const more = findings.length - shown.length;
  return [
    "Untrusted input reaches (name-based data flow — a place to look, not a verdict; the rest and the limits: `vibegraph-knowledge dataflow`):",
    ...shown,
    ...(more > 0 ? [`- … ${more} more`] : []),
  ].join("\n");
}

/** Each thread's findings, by entry point. */
export function findingsByThread(r: DataflowReport): Map<string, DataflowFinding[]> {
  const m = new Map<string, DataflowFinding[]>();
  for (const f of r.findings) for (const ep of f.entryPointIds) (m.get(ep) ?? m.set(ep, []).get(ep)!).push(f);
  return m;
}

/** The findings of one section, under one heading per file. */
function byFile(findings: DataflowFinding[]): string[] {
  const line = (f: DataflowFinding) => [
    `- **${KIND_LABEL[f.kind]}** in \`${f.sink.fn}\`${f.sink.line ? ` (line ${f.sink.line})` : ""}: \`${f.sink.text}\``,
    `  - untrusted: ${f.source.what}${f.source.line ? ` (${f.source.file}:${f.source.line})` : ""}`,
    `  - path: ${f.path.join(" → ")}`,
    ...(f.guard ? [`  - ${guardWords(f, true)}`] : []),
    ...(f.entryPointIds.length ? [`  - threads: ${f.entryPointIds.map((e) => `\`${e}\``).join(", ")}`] : []),
  ].join("\n");
  const files = new Map<string, DataflowFinding[]>();
  for (const f of findings) (files.get(f.sink.file) ?? files.set(f.sink.file, []).get(f.sink.file)!).push(f);
  return [...files].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).flatMap(([file, fs]) => [
    `### \`${file}\` (${fs.length})`, "",
    ...fs.sort((a, b) => (a.sink.line ?? 0) - (b.sink.line ?? 0)).map(line), "",
  ]);
}

export function formatDataflowMd(r: DataflowReport): string {
  const high = r.findings.filter((f) => f.severity === "high");
  const review = r.findings.filter((f) => f.severity === "review");
  return [
    "# Untrusted input → dangerous sinks (derived — a place to look, not a verdict)",
    "",
    `Request data, handler parameters, command-line arguments and \`input()\` followed by name through assignments and calls to shell commands, SQL query text and code evaluation. ${r.sources} source(s) seen; ${r.functionsReached} function(s) carry untrusted values.`,
    "",
    "What this cannot see:",
    ...r.limits.map((l) => `- ${l}`),
    "",
    `## Unguarded (${high.length})`,
    "",
    ...(high.length ? byFile(high) : ["None matched.", ""]),
    `## To review (${review.length}) — a condition or a check on the way, or an argument-level sink`,
    "",
    ...(review.length ? byFile(review) : ["None matched.", ""]),
  ].join("\n");
}
