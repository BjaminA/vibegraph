// THE COVERAGE LEDGER (2026-10-22, the root-cause handoff RC2: "the analysis
// does not say what it did not read"). Every file the walk saw, accounted
// for: read (and, for a `.js` or a page, why), read and failed, deferred with
// why, code no frontend reads, a skipped folder, or plain documents, data and
// assets. Built by src/server/source_walk.ts; shown in the export README, the
// architecture page, `vibegraph-knowledge coverage` and the setup panel, so an
// unread share is said wherever the analysis is. Webview-safe.

export interface LedgerFile { file: string; lines: number; reason: string }
export interface LedgerGroup { kind: string; files: number; lines: number; examples: string[] }

export interface CoverageLedger {
  /** read by a frontend, failures excluded */
  parsed: { files: number; lines: number; byLanguage: Record<string, { files: number; lines: number }> };
  /** `.js`/`.jsx` read because evidence named them (counted in parsed) */
  admitted: LedgerFile[];
  /** pages read as their inline scripts (counted in parsed, by script lines) */
  pages: LedgerFile[];
  /** walked, and the parser produced nothing (not counted in parsed) */
  failed: LedgerFile[];
  /** `.js`/`.jsx`/pages not read, with why */
  deferred: LedgerFile[];
  /** code no frontend reads, grouped by kind */
  notRead: LedgerGroup[];
  /** folders not walked → the files they held */
  skippedDirs: Record<string, number>;
  /** documents, data and assets: files */
  other: number;
}

/** File kinds that carry behaviour no frontend reads, by extension or name.
 *  Data: GitHub Linguist's programming, markup-with-code and config-that-runs
 *  kinds a repository commonly holds. Add a row when one is met. */
export const UNREAD_CODE_KINDS: ReadonlyArray<{ kind: string; ext?: string[]; name?: RegExp; path?: RegExp }> = [
  { kind: "Vue / Svelte / Astro components", ext: [".vue", ".svelte", ".astro"] },
  { kind: "SQL", ext: [".sql"] },
  { kind: "notebooks", ext: [".ipynb"] },
  { kind: "Go", ext: [".go"] },
  { kind: "Java / Kotlin / Scala", ext: [".java", ".kt", ".kts", ".scala", ".groovy"] },
  { kind: "Ruby", ext: [".rb"] },
  { kind: "PHP", ext: [".php"] },
  { kind: "C#", ext: [".cs"] },
  { kind: "Swift / Objective-C", ext: [".swift", ".m", ".mm"] },
  { kind: "C", ext: [".c"] },
  { kind: "Lua / Perl / R", ext: [".lua", ".pl", ".pm", ".r"] },
  { kind: "Elixir / Dart", ext: [".ex", ".exs", ".dart"] },
  { kind: "PowerShell / batch / zsh / fish", ext: [".ps1", ".bat", ".cmd", ".zsh", ".fish"] },
  { kind: "Terraform", ext: [".tf", ".hcl"] },
  { kind: "Dockerfiles", name: /^Dockerfile(\..+)?$|\.dockerfile$/i },
  { kind: "Makefiles", name: /^(GNUmakefile|Makefile|makefile)$/ },
  { kind: "CI workflows", path: /^\.github\/workflows\/[^/]+\.ya?ml$/ },
];

/** The unread-code kind of a path, or null for documents, data and assets. */
export function unreadKindOf(rel: string): string | null {
  const base = rel.split("/").pop() ?? rel;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  return UNREAD_CODE_KINDS.find((k) => (k.ext && ext && k.ext.includes(ext)) || k.name?.test(base) || k.path?.test(rel))?.kind ?? null;
}

const n = (x: number) => x.toLocaleString("en-GB");
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;

/** What was not analysed, as a count: deferred, failed and unread code (skipped folders apart). */
export function ledgerUnread(l: CoverageLedger): { files: number; lines: number } {
  const groups = [...l.deferred, ...l.failed];
  return {
    files: groups.length + l.notRead.reduce((s, g) => s + g.files, 0),
    lines: groups.reduce((s, f) => s + f.lines, 0) + l.notRead.reduce((s, g) => s + g.lines, 0),
  };
}

/** One line: "not analysed: 2 files, 6,100 lines", or null when everything code-like was read. */
export function ledgerHeadline(l: CoverageLedger): string | null {
  const u = ledgerUnread(l);
  return u.files ? `not analysed: ${plural(u.files, "file")}, ${plural(u.lines, "line")}` : null;
}

/** The ledger as Markdown lines (the export README, architecture.md, the CLI). */
export function ledgerInWords(l: CoverageLedger, max = 12): string[] {
  const out: string[] = [];
  const langs = Object.entries(l.parsed.byLanguage).map(([k, v]) => `${k} ${plural(v.files, "file")} (${plural(v.lines, "line")})`).join(", ");
  out.push(`Read: ${plural(l.parsed.files, "file")}, ${plural(l.parsed.lines, "line")}${langs ? ` (${langs})` : ""}.`);
  const head = ledgerHeadline(l);
  out.push(head ? `${head[0].toUpperCase()}${head.slice(1)}, listed below. Nothing VibeGraph shows describes them.` : "Every code file the walk saw was read.");
  const list = (title: string, xs: LedgerFile[]) => {
    if (!xs.length) return;
    out.push("", `**${title}** (${xs.length}):`);
    for (const f of xs.slice(0, max)) out.push(`- \`${f.file}\` (${plural(f.lines, "line")}): ${f.reason}`);
    if (xs.length > max) out.push(`- and ${xs.length - max} more`);
  };
  list("Read because the evidence names them", l.admitted);
  list("Pages read as their inline scripts", l.pages);
  list("Read, and the parser produced nothing", l.failed);
  list("Not read", l.deferred);
  if (l.notRead.length) {
    out.push("", `**Code no frontend reads:**`);
    for (const g of l.notRead) out.push(`- ${g.kind}: ${plural(g.files, "file")}, ${plural(g.lines, "line")} (${g.examples.map((e) => `\`${e}\``).join(", ")}${g.files > g.examples.length ? ", …" : ""})`);
  }
  const dirs = Object.entries(l.skippedDirs);
  if (dirs.length) out.push("", `**Folders not walked:** ${dirs.map(([d, k]) => `\`${d}/\` (${plural(k, "file")})`).join(", ")}.`);
  out.push("", `Documents, data and assets: ${plural(l.other, "file")}, not code.`);
  return out;
}

/** The ledger as a page (the export's coverage.md, `vibegraph-knowledge coverage`). */
export function ledgerPage(l: CoverageLedger, project: string): string {
  return [
    `# What VibeGraph read in ${project}`,
    "",
    "Every file the walk saw, accounted for. A `.js` file is read only when something says it is source, and a page only for its inline scripts; anything not read is listed with why. Before saying code is unused, untested or absent, check that it was read.",
    "",
    ...ledgerInWords(l, 50),
    "",
  ].join("\n");
}

/** One line for the top of another page, or null when nothing code-like was left unread. */
export function ledgerNote(l: CoverageLedger | null | undefined): string | null {
  const head = l ? ledgerHeadline(l) : null;
  return head ? `> **${head[0].toUpperCase()}${head.slice(1)}** (\`coverage.md\` lists them, each with why). Nothing on this page describes them.` : null;
}
