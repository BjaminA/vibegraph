// Which software deserves a spec (2026-10-20, Ben's setup workflow: "run the
// software add to any bespoke software pieces"). Zero tokens, never a model:
// read from the stack index the code already has.
//
// The first live run (a public Next.js app, 154 files) measured why "no table
// knows it" is not "bespoke": of eight candidates, six were UI libraries
// (clsx, tailwind-merge, radix-ui…), and the packages that mattered (storage,
// the database driver) ranked below them or fell off the list. Not knowing a
// package's role is a question to ANSWER, not a reason to write its spec. So:
//
//   unclassified   a third-party package the code CALLS that no table knows
//                  and nobody has classified yet → classify first (`classify
//                  --apply`, one model call, every answer labelled a model's);
//   candidate      a package whose role makes it a BOUNDARY the code leaves
//                  through — a backend platform SDK a table knows (firebase,
//                  supabase: each carries its own model of identity, policy
//                  and data), or a package classified (by a model or a person)
//                  as a platform, database, cache, queue, cloud, remote,
//                  model API or agent protocol — that the code calls, has no
//                  spec yet and was not set aside. A table-known tool of any
//                  other role (react, zod, redis) is one the tables already
//                  describe; a utility or UI library needs no spec.
//
// Packages of one npm scope are one candidate (`@acme/client`, `@acme/server`
// → "acme"). The docs source is FOUND, never guessed: the installed package's
// manifest (homepage, repository), the package's published README (jsDelivr
// for npm, PyPI for Python — a real page `software add` can read), then a
// line of the project's own docs naming it beside a URL.
//
// Commands a shell script runs that no table knows (`jq`, an in-house CLI)
// are listed apart and never hold the step open.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StackIndexRecord, StackToolRecord } from "../shared/protocol.ts";
import type { SoftwareSpec } from "../shared/software_types.ts";

export interface SoftwareCandidate {
  /** the suggested spec name: an npm scope without its `@`, else the package */
  name: string;
  packages: string[];
  /** platform: a table knows it as one · classified: a model filed it · stated: a person did · table: a table knows its (boundary) role */
  kind: "platform" | "classified" | "stated" | "table";
  /** its role (the table's, or the classification's) */
  role: string;
  /** threads with a boundary leaving through it */
  calledOn: number;
  files: number;
  /** where a docs source was found: the package's own manifest, a project doc line, or its published README */
  docs: Array<{ url: string; from: string }>;
}

export interface CandidateReport {
  candidates: SoftwareCandidate[];
  /** more candidates than shown */
  more: number;
  /** called third-party packages no table knows and nobody classified — classify first */
  unclassified: Array<{ name: string; calledOn: number }>;
  /** shell commands no table knows — listed, never blocking */
  commands: Array<{ name: string; calledOn: number }>;
  /** names a person set aside, with why */
  skipped: Array<{ name: string; why: string }>;
}

const MAX_CANDIDATES = 8;
/** Roles whose calls cross a boundary the project does not own — what a spec is for. */
export const BOUNDARY_ROLES: ReadonlySet<string> = new Set(["platform", "db", "cache", "queue", "cloud", "remote", "model-api", "agent-protocol"]);

const isPackage = (t: StackToolRecord) => t.evidence.some((e) => e.kind === "import" || e.kind === "include" || e.kind === "config");
// 2026-10-20 (live run, second finding): a table knowing a tool's ROLE is not
// knowing how this project must use it — the session reached for the AI SDK
// and the redis client first, and a spec from their current docs is what a
// fast-moving SDK most needs. So a boundary tool a table knows is a candidate
// too, ranked after platforms and classified packages.
const kindOf = (t: StackToolRecord): SoftwareCandidate["kind"] | null =>
  !BOUNDARY_ROLES.has(t.role) ? null
    : t.roleSource === "stated" ? (t.roleStatedSource === "agent" ? "classified" : "stated")
      : t.role === "platform" ? "platform" : "table";
const groupKey = (tool: string) => (tool.startsWith("@") && tool.includes("/") ? tool.split("/")[0].slice(1) : tool);
const RANK = { platform: 0, stated: 1, classified: 2, table: 3 } as const;

/** The candidates, from the stack index, the specs on disk and what a person set aside. */
export function softwareCandidates(root: string, stack: Pick<StackIndexRecord, "tools">, specs: SoftwareSpec[], skipped: Record<string, { why: string }> = {}): CandidateReport {
  const covered = new Set(specs.flatMap((s) => [s.tool, ...(s.identity?.packages ?? [])]));
  const groups = new Map<string, { tools: StackToolRecord[]; kind: SoftwareCandidate["kind"] }>();
  const commands: CandidateReport["commands"] = [];
  const unclassified: CandidateReport["unclassified"] = [];
  for (const t of stack.tools) {
    if (t.origin !== "third-party" && t.origin !== "unknown") continue;
    const called = t.calledOn?.length ?? 0;
    if (called === 0) continue;
    if (!isPackage(t)) { if (t.role === "unknown") commands.push({ name: t.tool, calledOn: called }); continue; }
    const key = groupKey(t.tool);
    if (covered.has(t.tool) || covered.has(key)) continue;
    if (t.role === "unknown" && t.roleSource !== "stated") { if (!skipped[t.tool] && !skipped[key]) unclassified.push({ name: t.tool, calledOn: called }); continue; }
    const kind = kindOf(t);
    if (!kind) continue;
    const g = groups.get(key) ?? { tools: [], kind };
    g.tools.push(t);
    if (RANK[kind] < RANK[g.kind]) g.kind = kind;
    groups.set(key, g);
  }
  const candidates: SoftwareCandidate[] = [];
  const set: CandidateReport["skipped"] = [];
  for (const [name, g] of groups) {
    if (skipped[name]) { set.push({ name, why: skipped[name].why }); continue; }
    const calledOn = new Set(g.tools.flatMap((t) => t.calledOn ?? [])).size;
    const files = new Set(g.tools.flatMap((t) => t.files)).size;
    candidates.push({ name, packages: g.tools.map((t) => t.tool).sort(), kind: g.kind, role: g.tools[0].role, calledOn, files, docs: findDocs(root, name, g.tools) });
  }
  for (const [name, s] of Object.entries(skipped)) if (!groups.has(name) && !set.some((x) => x.name === name)) set.push({ name, why: s.why });
  candidates.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.calledOn - a.calledOn || (a.name < b.name ? -1 : 1));
  unclassified.sort((a, b) => b.calledOn - a.calledOn || (a.name < b.name ? -1 : 1));
  commands.sort((a, b) => b.calledOn - a.calledOn || (a.name < b.name ? -1 : 1));
  return { candidates: candidates.slice(0, MAX_CANDIDATES), more: Math.max(0, candidates.length - MAX_CANDIDATES), unclassified, commands: commands.slice(0, 8), skipped: set };
}

/** A repository field as a browsable URL, or null. */
export function repoUrl(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { url?: unknown }).url : null;
  if (typeof v !== "string" || !v.trim()) return null;
  let u = v.trim().replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://");
  const short = /^(github|gitlab|bitbucket):(.+)$/.exec(u);
  if (short) u = `https://${short[1]}.${short[1] === "bitbucket" ? "org" : "com"}/${short[2]}`;
  else if (/^[\w.-]+\/[\w.-]+$/.test(u)) u = `https://github.com/${u}`;
  return /^https?:\/\//.test(u) ? u : null;
}

/** A package's published README: a real page for `software add` when nothing better is found. */
export function publishedReadme(t: Pick<StackToolRecord, "tool" | "version" | "evidence">): { url: string; from: string } | null {
  const files = t.evidence.map((e) => e.file);
  const exact = t.version && /^\d+\.\d+\.\d+/.test(t.version.replace(/^[\^~=v]+/, "")) ? t.version.replace(/^[\^~=v]+/, "") : null;
  if (files.some((f) => /\.(m|c)?[jt]sx?$/.test(f) || /(^|\/)package\.json$/.test(f))) {
    return { url: `https://cdn.jsdelivr.net/npm/${t.tool}${exact ? `@${exact}` : ""}/README.md`, from: `${t.tool}'s published README (jsDelivr${exact ? `, the version the manifest declares` : ""})` };
  }
  if (files.some((f) => f.endsWith(".py") || /(requirements.*\.txt|pyproject\.toml)$/.test(f))) {
    return { url: `https://pypi.org/pypi/${t.tool}/json`, from: `${t.tool}'s PyPI entry (its description is the README)` };
  }
  return null;
}

function findDocs(root: string, name: string, tools: StackToolRecord[]): SoftwareCandidate["docs"] {
  const packages = tools.map((t) => t.tool);
  const out: SoftwareCandidate["docs"] = [];
  const add = (url: string, from: string) => { if (!out.some((d) => d.url === url) && out.length < 3) out.push({ url, from }); };
  for (const p of packages) {
    try {
      const pj = JSON.parse(readFileSync(join(root, "node_modules", p, "package.json"), "utf-8"));
      const home = typeof pj.homepage === "string" && /^https?:\/\//.test(pj.homepage) ? pj.homepage : null;
      if (home) add(home, `${p}'s package.json homepage`);
      const repo = repoUrl(pj.repository);
      if (repo) add(repo, `${p}'s package.json repository`);
    } catch { /* not installed here */ }
  }
  // The project's own markdown: a line naming the tool beside a URL. It is
  // the package's DOCUMENTATION when it names the package by its exact
  // spelling (`@acme/ledger-client`, `drizzle-orm`, a backticked name) or
  // says it is docs; a bare word is a mention. The live run drafted the
  // `postgres` driver from "[Neon Serverless Postgres](…/marketplace/neon)" —
  // a link to its HOSTING provider (20 of 57 items unquoted) — when the
  // driver's own README was one fetch away. So: docs lines, then the
  // package's published README, then mentions.
  const docsLines: Array<{ url: string; from: string }> = [];
  const mentions: Array<{ url: string; from: string }> = [];
  const words = [...new Set([name, ...packages])].filter((w) => w.length >= 4).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length) {
    const named = new RegExp(`(^|[^\\w@/-])(${words.join("|")})([^\\w-]|$)`, "i");
    const exact = packages.filter((p) => /[@/.-]/.test(p));
    outer: for (const file of projectMarkdown(root)) {
      let text = "";
      try { text = readFileSync(file, "utf-8"); } catch { continue; }
      for (const line of text.split("\n")) {
        if (!named.test(line)) continue;
        const specific = exact.some((p) => line.includes(p)) || packages.some((p) => line.includes(`\`${p}\``));
        for (const m of line.matchAll(/https?:\/\/[^\s)<>"'`\]]+/g)) {
          const url = m[0].replace(/[.,;:]+$/, "");
          const docs = specific || /\b(docs?|documentation|reference|api|guide)\b/i.test(line.replace(url, "")) || /\/(docs?|reference|api)(\/|$)/i.test(url);
          (docs ? docsLines : mentions).push({ url, from: file.slice(root.length + 1) });
        }
        if (docsLines.length + mentions.length >= 6) break outer;
      }
    }
  }
  for (const d of docsLines) add(d.url, d.from);
  for (const t of tools) { const r = publishedReadme(t); if (r) { add(r.url, r.from); break; } }
  for (const d of mentions) add(d.url, d.from);
  return out;
}

function projectMarkdown(root: string): string[] {
  const files = ["README.md", "CLAUDE.md", "HANDOVER.md", "ARCHITECTURE.md"].map((f) => join(root, f)).filter((p) => existsSync(p));
  const walk = (dir: string, depth: number) => {
    if (depth > 2 || files.length >= 32) return;
    let names: string[] = [];
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const n of names) {
      if (n.startsWith(".") || n === "node_modules") continue;
      const p = join(dir, n);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
        else if (/\.md$/i.test(n) && files.length < 32 && !files.includes(p)) files.push(p);
      } catch { /* unreadable */ }
    }
  };
  walk(join(root, "docs"), 0);
  return files;
}
