// RULE CANDIDATES FROM THE PROJECT'S OWN PROSE (2026-10-17, from a field run:
// a project's real operator rules — "must be a root-owned copy, never a
// symlink", "a DENY below a matching PERMIT is inert", "the credits database
// must have no user grants" — sat in its CLAUDE.md and module headers, and
// its constraints.json held none of them).
//
// DERIVED and zero tokens: this finds rule-SHAPED sentences and says where
// they are. It never writes a rule. A sentence is a candidate when it
//   - carries a rule marker (must, never, always, only, do not, cannot,
//     forbidden, required, "no other", "the one", "leaves through" …), and
//   - names something the IR knows (a file, a function or class, a tool from
//     the stack index, an environment variable the code reads) as a
//     code-shaped token — or sits in a module header / docstring, which is
//     anchored to its own file or function by where it is.
// Candidates are ranked: anchors, marker strength, location (a module header,
// a heading or table about rules), minus a penalty for narrative (a date, a
// past-tense record — a CLAUDE.md that is a history is mostly that).
// Where the shape is unambiguous a grammar check is SUGGESTED, never stored.
//
// The next step is a reader's: `/vibegraph-rules` (the task skill) has the
// session's Claude read each candidate in context and state the real ones
// with `constraints add --cite file:line` (agent-stated, a person ratifies);
// a person can do the same from the list.

import * as fs from "fs";
import * as path from "path";
import { isTestFile } from "../shared/path_match.ts";

/** path: a file-shaped token under a directory the IR knows, where no such file exists (yet) · route: a route literal an
 *  entry point serves · key: a payload key some call site sends (the IR's argKeys) — a rule about what must never be sent */
export interface HarvestAnchor { kind: "file" | "function" | "tool" | "env" | "route" | "path" | "key"; id: string }
export interface RuleCandidate {
  score: number;
  file: string;
  line: number;
  /** prose: a markdown file · header: a source file's leading comment · docstring: a function's */
  where: "prose" | "header" | "docstring";
  /** the markdown heading (or the function) the sentence sits under */
  under?: string;
  /** verbatim, whitespace-normalised */
  quote: string;
  anchors: HarvestAnchor[];
  markers: string[];
  /** a grammar clause the sentence's shape maps to — a suggestion to check, never stored here */
  suggestedCheck?: Record<string, unknown>;
  /** 2026-10-19 (M3) — the scope the rule GOVERNS, read from what it names: a funnel module →
   *  every thread using it or its tool; a route → its thread; a function → its file; a module not
   *  built yet → its folder. The prose writer had scoped each rule to the file its sentence sits on. */
  suggestedScope?: { entryPointIds?: string[]; files?: string[]; stack?: string[] };
  narrative: boolean;
}
export interface HarvestReport {
  candidates: RuleCandidate[];
  /** sentences read, prose files read, source headers read */
  read: { sentences: number; proseFiles: number; headers: number; docstrings: number };
  limits: string[];
}

interface IrNodeLike { type?: string; name?: string; docstring?: string; line?: number; id?: string; argKeys?: unknown[] }
interface IrLike { language?: string; nodes?: IrNodeLike[]; envReads?: Array<{ name?: unknown }> }
interface StackLike { tools?: Array<{ tool: string; origin?: string; home?: string; wraps?: string[] }> }

export const HARVEST_LIMITS = [
  "a candidate is a rule-shaped sentence, not a rule: a person (or the /vibegraph-rules skill with a person ratifying) decides which are the operators' rules",
  "a sentence that names no file, function, tool or environment variable the IR knows is not listed — a rule about something outside the code is out of reach here",
  "narrative (a date, a record of what was fixed or shipped) is penalised, not excluded: a history file still lists its rule-shaped lines, low",
  "a suggested check is read off the sentence's shape; `constraints add --dry-run` runs it against the code before anything is stored",
];

/** Measured on examples/fleet-telemetry (six stated rules as the oracle): at
 *  5 every oracle row and the module headers that restate them are listed and
 *  the behaviour-describing docstrings ("Celsius passes through") are not. */
export const DEFAULT_MIN = 5;

const SKIP_DIRS = new Set(["node_modules", ".git", ".vibegraph", "dist", "build", "out", "target", "venv", ".venv", "__pycache__", "coverage", "vendor", ".next"]);
const SKIP_PROSE = /^(CHANGELOG|LICENSE|LICENCE|HISTORY|PLAN-HISTORY|CODE_OF_CONDUCT)[\w.-]*\.md$/i;
const RECORD_PATH = /(^|\/)(reviews|history|changelog|archive|notes?)(\/|$)|^PLAN[-\w]*\.md$/i;

// marker → strength. "the ONE" / "no other" / "never" bind hardest.
const MARKERS: Array<[RegExp, string, number]> = [
  [/\bnever\b/i, "never", 3], [/\bmust not\b|\bmust never\b/i, "must not", 3], [/\bno other\b/i, "no other", 3],
  [/\bthe one\b|\bthe only\b|\bexactly one\b|\bsingle source of truth\b/i, "the one", 3], [/\bforbidden\b|\bnot allowed\b|\bprohibited\b/i, "forbidden", 3],
  [/\bmust\b/i, "must", 2], [/\balways\b/i, "always", 2], [/\bonly\b/i, "only", 2], [/\bcannot\b|\bcan't\b|\bmay not\b/i, "cannot", 2],
  [/\bdo not\b|\bdon't\b|\bdoes not\b|\bshould not\b|\bshouldn't\b/i, "do not", 1],
  [/\b(leaves?|goes|go|routed?|sent|send|flows?) (only )?through\b/i, "through", 2], [/\bby position\b|\bin order\b(?! to)/i, "by position", 2],
  [/\bships? with\b|\bpredates?\b/i, "ships with", 1],
  // a rule stated as a FACT about what the code ignores or how it decides —
  // "a DENY below a matching PERMIT is inert", "first-match by rowid",
  // "instances: 1 is a correctness setting" — no modal, still a rule
  [/\bis inert\b|\bhas no effect\b|\bis ignored\b|\bis a no-op\b|\bis silently\b|\bis not read\b/i, "inert", 3],
  [/\bfirst[- ]match\b|\btakes? precedence\b|\bwins\b|\bshadows\b/i, "precedence", 2],
  [/\bcorrectness\b|\bmust (stay|remain)\b|\bkeep .{1,40} at\b/i, "correctness", 2],
];
// a record of what happened, or a description in the perfect tense ("has never seen it"), is not a rule
// ("the first four columns are fixed" is a rule; "was fixed" is a record — the verb needs its auxiliary or a date)
const NARRATIVE = /\b20\d\d-\d\d(-\d\d)?\b|\b(was|were|been|got|then)\s+(fixed|shipped|landed|found|measured|regenerated|verified|refactored|renamed|moved|closed|reverted)\b|\b(was|were|used to|had been|until|since)\b|\b(has|have|had) (never|always|only)\b|\bnever (seen|been|had)\b/i;
const RULE_HEADING = /\b(rules?|constraints?|invariants?|never|must|hard|operat|runbook|conventions?|policy|policies|contract|does not say|cannot tell|gotchas?|why this exists)\b/i;
// release notes under any file name: a heading that is a version or "Unreleased" is a record
const RECORD_HEADING = /^(version\s+)?v?\d+\.\d+(\.\d+)?\b|^(unreleased|release notes?|changelog|history)\b/i;
// files whose prose describes a sample or a test, not the project's own rules
const ASIDE_PATH = /(^|\/)(examples?|samples?|demos?|fixtures?|tutorials?|__mocks__)\//i;
/** a sentence that OPENS as an instruction: "Never …", "Do not …", "Keep …" */
const IMPERATIVE_START = /^(\*\*)?(never|always|only|do not|don't|keep|use|avoid|prefer|call|run|order|prefix|treat|put|leave|set)\b/i;
/** the parenthetical asides of a sentence: markers inside them describe, they do not rule */
const stripAsides = (s: string) => s.replace(/\([^()]*\)/g, " ");

/** a code-shaped token: backticked, a path, dotted, UPPER_CASE, snake_case, camelCase */
const TOKEN = /`([^`\n]{2,80})`|((?:[\w.-]+\/)+[\w.-]+)|\b([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)\b|\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b|\b([a-z][a-z0-9]*_[a-z0-9_]+|[a-z]+[A-Z]\w+)\b/g;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Sentences of one paragraph, each with the offset line it starts on. */
function sentencesOf(paragraph: Array<{ text: string; line: number }>): Array<{ text: string; line: number }> {
  const joined = paragraph.map((p) => p.text).join(" ");
  const starts = paragraph.map((p) => p.line);
  const out: Array<{ text: string; line: number }> = [];
  let pos = 0;
  for (const part of joined.split(/(?<=[.!?])\s+(?=[A-Z`"(*_-])/)) {
    const text = norm(part);
    if (text.length >= 20) {
      // the paragraph line whose cumulative text reaches this sentence
      let acc = 0, line = starts[0];
      for (let i = 0; i < paragraph.length; i++) { if (acc + paragraph[i].text.length + 1 > pos) { line = starts[i]; break; } acc += paragraph[i].text.length + 1; }
      out.push({ text, line });
    }
    pos += part.length + 1;
  }
  return out;
}

/** Markdown → sentences with their heading, skipping fenced code; a table row is one sentence. */
export function proseSentences(md: string): Array<{ text: string; line: number; under?: string; table?: boolean }> {
  const out: Array<{ text: string; line: number; under?: string; table?: boolean }> = [];
  const lines = md.split(/\r?\n/);
  let fence = false, under: string | undefined, tableHead: string | undefined;
  let para: Array<{ text: string; line: number }> = [];
  const flush = () => { if (para.length) for (const s of sentencesOf(para)) out.push({ ...s, under }); para = []; };
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (/^\s*(```|~~~)/.test(raw)) { flush(); fence = !fence; return; }
    if (fence) return;
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(raw);
    if (h) { flush(); under = norm(h[1].replace(/[`*_]/g, "")); tableHead = undefined; return; }
    if (/^\s*\|/.test(raw)) {
      flush();
      const cells = raw.split("|").slice(1, -1).map(norm).filter(Boolean);
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return;
      if (!tableHead) { tableHead = cells.join(" | "); return; }
      out.push({ text: cells.join(" — "), line, under: `${under ?? ""} | ${tableHead}`.replace(/^ \| /, ""), table: true });
      return;
    }
    tableHead = undefined;
    if (!raw.trim()) { flush(); return; }
    const text = norm(raw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").replace(/^\s*>\s?/, ""));
    if (text) para.push({ text, line });
  });
  flush();
  return out;
}

/** The leading comment or docstring of a source file, by its language. */
export function headerOf(src: string, language: string | undefined): Array<{ text: string; line: number }> {
  const lines = src.split(/\r?\n/);
  const out: Array<{ text: string; line: number }> = [];
  let i = 0;
  if (lines[0]?.startsWith("#!")) i = 1;
  while (i < lines.length && !lines[i].trim()) i++;
  const push = (t: string, line: number) => { const n = norm(t); if (n) out.push({ text: n, line }); };
  if (language === "python") {
    const m = /^\s*[rRuU]?("""|''')(.*)$/.exec(lines[i] ?? "");
    if (m) {
      const q = m[1];
      let rest = m[2];
      if (rest.includes(q)) { push(rest.slice(0, rest.indexOf(q)), i + 1); return out; }
      push(rest, i + 1);
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].includes(q)) { push(lines[j].slice(0, lines[j].indexOf(q)), j + 1); return out; }
        push(lines[j], j + 1);
      }
      return out;
    }
  }
  const lineComment = language === "python" || language === "bash" ? /^\s*#(?!!)\s?(.*)$/ : /^\s*\/\/\s?(.*)$/;
  if (language !== "python" && language !== "bash" && /^\s*\/\*/.test(lines[i] ?? "")) {
    for (let j = i; j < lines.length; j++) {
      const t = lines[j].replace(/^\s*\/\*+/, "").replace(/\*+\/\s*$/, "").replace(/^\s*\*\s?/, "");
      push(t, j + 1);
      if (/\*\//.test(lines[j])) return out;
    }
    return out;
  }
  for (let j = i; j < lines.length; j++) {
    const m = lineComment.exec(lines[j]);
    if (!m) break;
    push(m[1], j + 1);
  }
  return out;
}

export function markersIn(text: string): Array<{ name: string; strength: number }> {
  const out: Array<{ name: string; strength: number }> = [];
  const main = stripAsides(text);
  for (const [re, name, strength] of MARKERS) {
    if (re.test(main)) out.push({ name, strength });
    else if (re.test(text)) out.push({ name, strength: 1 }); // only inside a parenthetical aside
  }
  return out;
}

interface Known {
  files: Set<string>; byBase: Map<string, string[]>; dirs: Set<string>; functions: Set<string>; tools: Set<string>; envs: Set<string>; routes: Set<string>; keys: Set<string>;
  /** funnel home file → the funnel's tool name and what it wraps */
  funnels: Map<string, { tool: string; wraps: string[] }>;
  fnFiles: Map<string, Set<string>>;
  /** every entry point serving the route (a gateway and the service behind it can both serve `/ingest`) */
  routeEntry: Map<string, string[]>;
  entryFile: Map<string, string>;
}
interface EntryLike { id?: string; file?: string; metadata?: { route?: unknown } }

function knownOf(files: Record<string, IrLike>, stack: StackLike | null, entryPoints: ReadonlyArray<EntryLike>): Known {
  const k: Known = { files: new Set(Object.keys(files)), byBase: new Map(), dirs: new Set(), functions: new Set(), tools: new Set(), envs: new Set(), routes: new Set(), keys: new Set(), funnels: new Map(), fnFiles: new Map(), routeEntry: new Map(), entryFile: new Map() };
  for (const e of entryPoints) {
    if (e.id && e.file) k.entryFile.set(e.id, e.file);
    if (typeof e.metadata?.route !== "string") continue;
    k.routes.add(e.metadata.route);
    if (e.id) (k.routeEntry.get(e.metadata.route) ?? k.routeEntry.set(e.metadata.route, []).get(e.metadata.route)!).push(e.id);
  }
  for (const t of stack?.tools ?? []) if (t.origin === "project" && t.home) k.funnels.set(t.home, { tool: t.tool, wraps: t.wraps ?? [] });
  for (const [f, ir] of Object.entries(files)) for (const n of ir.nodes ?? []) if (n.type === "function_def" && n.name) (k.fnFiles.get(n.name) ?? k.fnFiles.set(n.name, new Set()).get(n.name)!).add(f);
  for (const f of k.files) {
    const base = path.posix.basename(f);
    (k.byBase.get(base) ?? k.byBase.set(base, []).get(base)!).push(f);
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) k.dirs.add(parts.slice(0, i).join("/"));
  }
  for (const ir of Object.values(files)) {
    for (const n of ir.nodes ?? []) {
      if ((n.type === "function_def" || n.type === "class_def") && n.name) k.functions.add(n.name);
      // argKeys is per argument: [["model", "messages", "temperature"]]
      for (const key of (n.argKeys ?? []).flat()) if (typeof key === "string" && /^[A-Za-z_][\w.]*$/.test(key)) k.keys.add(key.split(".")[0]);
    }
    for (const r of ir.envReads ?? []) if (typeof r.name === "string") k.envs.add(r.name);
  }
  for (const t of stack?.tools ?? []) k.tools.add(t.tool);
  return k;
}

/** The IR-known things a sentence names, as code-shaped tokens. */
export function anchorsIn(text: string, k: Known): HarvestAnchor[] {
  const out = new Map<string, HarvestAnchor>();
  const add = (kind: HarvestAnchor["kind"], id: string) => out.set(`${kind}:${id}`, { kind, id });
  for (const m of text.matchAll(/`(\/[\w/-]*)`|(?<![\w`])(\/[a-z][\w/-]*)(?=[\s,.;:)`]|$)/g)) {
    const r = (m[1] ?? m[2]).replace(/\/$/, "");
    if (r && k.routes.has(r)) add("route", r);
  }
  for (const m of text.matchAll(TOKEN)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).replace(/[.,;:)]+$/, "").replace(/\(.*\)$/, "");
    if (!raw) continue;
    const t = raw.replace(/^\.\//, "");
    if (k.files.has(t)) { add("file", t); continue; }
    if (k.dirs.has(t.replace(/\/$/, ""))) { add("file", `${t.replace(/\/$/, "")}/`); continue; }
    // a file-shaped path under a directory the IR knows, where the file does not exist (yet) — the thing a rule may be about
    if (/\//.test(t) && /\.\w+$/.test(t) && k.dirs.has(t.split("/").slice(0, -1).join("/"))) { add("path", t); continue; }
    const base = path.posix.basename(t);
    if (k.byBase.has(base) && k.byBase.get(base)!.length === 1 && /\.\w+$/.test(base)) { add("file", k.byBase.get(base)![0]); continue; }
    if (k.envs.has(t)) { add("env", t); continue; }
    if (k.tools.has(t) || k.tools.has(t.split(".")[0])) { add("tool", k.tools.has(t) ? t : t.split(".")[0]); continue; }
    const last = t.split(".").pop()!;
    if (k.functions.has(last) && (m[1] || m[3] || m[5])) { add("function", t); continue; }
    // a payload key the code sends somewhere, named in backticks (a bare word would match too much)
    if (m[1] && k.keys.has(t)) { add("key", t); continue; }
    // `module.function` where the module is a file: telemetry.storage → telemetry/storage.py
    const dotted = t.split(".");
    if (dotted.length >= 2) {
      const asPath = dotted.slice(0, -1).join("/");
      const hit = [...k.files].find((f) => f.replace(/\.\w+$/, "") === asPath || f.replace(/\.\w+$/, "").endsWith(`/${asPath}`));
      if (hit) add("file", hit);
    }
  }
  return [...out.values()];
}

const DOOR = (markers: string[]) => markers.some((m) => m === "through" || m === "only" || m === "the one" || m === "never" || m === "must");

function suggest(text: string, anchors: HarvestAnchor[], markers: string[], k: Known): Record<string, unknown> | undefined {
  const tools = anchors.filter((a) => a.kind === "tool").map((a) => a.id);
  const files = anchors.filter((a) => a.kind === "file" && !a.id.endsWith("/")).map((a) => a.id);
  if (tools.length === 1) {
    if (files.length === 1 && DOOR(markers)) return { rule: "import-only", tool: tools[0], files };
    if (!files.length && markers.some((m) => m === "never" || m === "forbidden" || m === "must not")) return { policy: { tool: tools[0], rule: "forbid" } };
    return undefined;
  }
  // "every call leaves through <funnel file>": the funnel's one wrapped tool is imported only there
  const funnel = files.length === 1 && !tools.length ? k.funnels.get(files[0]) : undefined;
  if (funnel?.wraps.length === 1 && DOOR(markers)) return { rule: "import-only", tool: funnel.wraps[0], files };
  return undefined;
}

const PROHIBITION = new Set(["never", "no other", "the one", "only", "must not", "forbidden"]);
const area = (f: string) => (f.includes("/") ? `${f.split("/")[0]}/` : f);

/** The scope a rule governs, from what its sentence names (never the file the sentence sits in,
 *  unless it names nothing else). A scope decides who is TOLD before an edit; a check catches a
 *  break after it wherever it is written. So a prohibition WITHOUT a check must reach the whole
 *  area a violation could be written in — its anchors' top-level folders, narrowed to the ones the
 *  sentence names as a word ("the gateway never forwards…") — and one with a check keeps the
 *  precise scope. M3 measured the precise-only suggestion at 0.35 routing overlap with a person's
 *  scopes, which scoped "no other module may call notify" to the whole service. */
function suggestScope(anchors: HarvestAnchor[], k: Known, markers: string[] = [], text = "", hasCheck = false): RuleCandidate["suggestedScope"] {
  const precise = preciseScope(anchors, k);
  if (!precise || hasCheck || !markers.some((m) => PROHIBITION.has(m))) return precise;
  const areas = new Set<string>([...(precise.files ?? []).map(area), ...(precise.entryPointIds ?? []).map((id) => area(k.entryFile.get(id) ?? id.split(":")[0]))]);
  if (!areas.size) return precise;
  const named = [...areas].filter((a) => a.endsWith("/") && new RegExp(`\\b${a.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  return { files: named.length ? named : [...areas], ...(precise.stack ? { stack: precise.stack } : {}) };
}

function preciseScope(anchors: HarvestAnchor[], k: Known): RuleCandidate["suggestedScope"] {
  const entryPointIds = new Set<string>(), files = new Set<string>(), stack = new Set<string>();
  for (const a of anchors) {
    if (a.kind === "route") for (const id of k.routeEntry.get(a.id) ?? []) entryPointIds.add(id);
    else if (a.kind === "tool") stack.add(a.id);
    else if (a.kind === "file") {
      const f = k.funnels.get(a.id);
      if (f) { stack.add(f.tool); for (const w of f.wraps) stack.add(w); } else files.add(a.id);
    } else if (a.kind === "function") {
      const defs = k.fnFiles.get(a.id.split(".").pop()!);
      if (defs?.size === 1) files.add([...defs][0]);
    } else if (a.kind === "path") files.add(`${a.id.split("/").slice(0, -1).join("/")}/`);
  }
  // a funnel's own file is inside its stack scope: listing it again adds nothing
  const out = {
    ...(entryPointIds.size ? { entryPointIds: [...entryPointIds] } : {}),
    ...(files.size ? { files: [...files] } : {}),
    ...(stack.size ? { stack: [...stack] } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** Named anchors count 2 each (to 3); the implicit anchor of a header or
 *  docstring to its own file counts 1 in all — it is where the sentence sits,
 *  not what it names. A module header is where "why this exists" is written
 *  (+2); a function docstring mostly describes behaviour (nothing). */
function score(c: Omit<RuleCandidate, "score">, named: number, strength: number, table: boolean): number {
  let s = Math.min(named, 3) * 2 + (c.anchors.length > named ? 1 : 0) + strength;
  if (c.where === "header") s += 2;
  if (c.under && RULE_HEADING.test(c.under)) s += 2;
  if (table) s += 1;
  if (IMPERATIVE_START.test(c.quote)) s += 1;
  // "`fetchDevice` never enumerates…" describes what a symbol does; a rule says what must hold
  else if (/^[`\w.]+`?\s/.test(c.quote) && /^`/.test(c.quote) && !c.markers.some((m) => m === "must" || m === "must not" || m === "do not" || m === "forbidden")) s -= 1;
  if (c.narrative) s -= 3;
  if (isTestFile(c.file) || ASIDE_PATH.test(c.file)) s -= 2;
  if (c.quote.length > 220) s -= 2;
  return s;
}

function walkProse(root: string): string[] {
  const out: string[] = [];
  const go = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) go(full, depth + 1); continue; }
      if (!e.isFile() || !/\.md$/i.test(e.name) || SKIP_PROSE.test(e.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (depth === 0 || /^(docs?|doc|wiki|\.claude)\//.test(rel) || /^(CLAUDE|AGENTS|README|CONTRIBUTING|ARCHITECTURE|OPERATIONS|RUNBOOK)[\w.-]*\.md$/i.test(e.name)) out.push(rel);
    }
  };
  go(root, 0);
  // the agents' own instruction files, wherever they sit
  for (const rel of [".claude/CLAUDE.md", "AGENTS.md", "CLAUDE.md"]) if (fs.existsSync(path.join(root, rel)) && !out.includes(rel)) out.push(rel);
  return [...new Set(out)];
}

export function harvestRules(
  root: string,
  env: { files: Record<string, IrLike>; entryPoints?: ReadonlyArray<EntryLike> },
  stack: StackLike | null,
  opts: { min?: number } = {},
): HarvestReport {
  const k = knownOf(env.files, stack, env.entryPoints ?? []);
  const read = { sentences: 0, proseFiles: 0, headers: 0, docstrings: 0 };
  const out: RuleCandidate[] = [];
  const consider = (file: string, s: { text: string; line: number; under?: string; table?: boolean }, where: RuleCandidate["where"], self: HarvestAnchor[] = []) => {
    read.sentences++;
    const ms = markersIn(s.text);
    if (!ms.length) return;
    const found = anchorsIn(s.text, k);
    const anchors = [...found, ...self.filter((a) => !found.some((f) => f.kind === a.kind && f.id === a.id))];
    if (!anchors.length) return;
    const names = ms.map((m) => m.name);
    const c: Omit<RuleCandidate, "score"> = {
      file, line: s.line, where, ...(s.under ? { under: s.under } : {}), quote: s.text.slice(0, 400), anchors, markers: names,
      narrative: NARRATIVE.test(s.text) || RECORD_PATH.test(file) || (!!s.under && RECORD_HEADING.test(s.under)),
    };
    const suggestedCheck = suggest(s.text, anchors, names, k);
    const suggestedScope = suggestScope(anchors, k, names, s.text, !!suggestedCheck);
    out.push({ score: score(c, found.length, Math.max(...ms.map((m) => m.strength)), !!s.table), ...c, ...(suggestedCheck ? { suggestedCheck } : {}), ...(suggestedScope ? { suggestedScope } : {}) });
  };
  for (const rel of walkProse(root)) {
    let text: string;
    try { if (fs.statSync(path.join(root, rel)).size > 512 * 1024) continue; text = fs.readFileSync(path.join(root, rel), "utf-8"); } catch { continue; }
    read.proseFiles++;
    for (const s of proseSentences(text)) consider(rel, s, "prose");
  }
  for (const [file, ir] of Object.entries(env.files)) {
    let src: string;
    try { src = fs.readFileSync(path.join(root, file), "utf-8"); } catch { continue; }
    const head = headerOf(src, ir.language);
    if (head.length) {
      read.headers++;
      for (const s of sentencesOf(head)) consider(file, s, "header", [{ kind: "file", id: file }]);
    }
    for (const n of ir.nodes ?? []) {
      if (n.type !== "function_def" || !n.docstring || !n.name) continue;
      read.docstrings++;
      const para = n.docstring.split(/\r?\n/).map((t, i) => ({ text: norm(t), line: (n.line ?? 1) + i })).filter((p) => p.text);
      for (const s of sentencesOf(para)) consider(file, { ...s, under: `${n.name}()` }, "docstring", [{ kind: "function", id: n.name }, { kind: "file", id: file }]);
    }
  }
  // the same sentence in a module header and its first function's docstring: once, at the higher score
  const byQuote = new Map<string, RuleCandidate>();
  for (const c of out.sort((a, b) => b.score - a.score)) { const key = `${c.file}|${c.quote}`; if (!byQuote.has(key)) byQuote.set(key, c); }
  const min = opts.min ?? DEFAULT_MIN;
  const candidates = [...byQuote.values()].filter((c) => c.score >= min).sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  return { candidates, read, limits: HARVEST_LIMITS };
}

export function formatHarvest(r: HarvestReport, opts: { min?: number; all?: boolean } = {}): string {
  const L = [
    `rule-shaped sentences that name code the IR knows: ${r.candidates.length} (of ${r.read.sentences} sentences in ${r.read.proseFiles} prose file(s), ${r.read.headers} source header(s), ${r.read.docstrings} docstring(s); score ≥ ${opts.min ?? DEFAULT_MIN})`,
    "A candidate is a place to read, not a rule. State the ones the operators mean with `constraints add … --cite <file>:<line>` (or `/vibegraph-rules`); a person ratifies.",
    "",
  ];
  // a module header that is a design note yields one candidate per sentence:
  // three per file in the list, the rest counted, so one file cannot fill it
  const perFile = new Map<string, number>();
  const folded = new Map<string, number>();
  const shown: RuleCandidate[] = [];
  for (const c of r.candidates) {
    const n = (perFile.get(c.file) ?? 0) + 1;
    perFile.set(c.file, n);
    if (!opts.all && n > 3) { folded.set(c.file, (folded.get(c.file) ?? 0) + 1); continue; }
    if (!opts.all && shown.length >= 40) { folded.set("…", (folded.get("…") ?? 0) + 1); continue; }
    shown.push(c);
  }
  for (const c of shown) {
    L.push(`[${String(c.score).padStart(2)}] ${c.file}:${c.line}${c.where !== "prose" ? ` (${c.where})` : ""}${c.under ? ` — under "${c.under.slice(0, 60)}"` : ""}${c.narrative ? " · narrative?" : ""}`);
    L.push(`     "${c.quote.length > 220 ? `${c.quote.slice(0, 217)}…` : c.quote}"`);
    L.push(`     names: ${c.anchors.map((a) => `${a.kind} ${a.id}`).join(", ")} · markers: ${c.markers.join(", ")}`);
    const sc = c.suggestedScope;
    if (sc || c.suggestedCheck) L.push(`     scope:${sc?.files ? ` --files ${sc.files.join(",")}` : ""}${sc?.stack ? ` --tools ${sc.stack.join(",")}` : ""}${sc?.entryPointIds ? ` --threads ${sc.entryPointIds.join(",")}` : ""}${c.suggestedCheck ? ` · try: --check '${JSON.stringify(c.suggestedCheck)}'` : ""}`);
  }
  const more = [...folded].filter(([f]) => f !== "…").map(([f, n]) => `${n} more in ${f}`);
  if (more.length || folded.get("…")) L.push(`… ${[...more, ...(folded.get("…") ? [`${folded.get("…")} more`] : [])].join("; ")} (--all)`);
  L.push("", "Limits:", ...r.limits.map((l) => `- ${l}`));
  return L.join("\n") + "\n";
}
