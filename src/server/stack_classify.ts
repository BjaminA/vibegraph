// M-CMD.3 (an internal field brief) — the FALLBACK for a tool no table
// knows: gather what the IR already says about how the codebase USES it,
// ask a model for a role and a one-line definition, and store the answer as
// an AGENT-STATED `describe` policy the stack index reads through the same
// stated-role channel a person's statement uses (M-CMD.2) — labelled as a
// model's classification everywhere the role shows, outranked by a human's
// statement, and ratified by a person changing `source` to "human".
//
// Why a pass and not a guess: the tables classify by EVIDENCE (a name
// someone wrote down). A model's reading of the usage is a different kind
// of claim, so it never enters the tables and never silently becomes a
// fact — it is a constraint with provenance, visible in the spec as
// "classified by c7 (agent, NOT human-reviewed)", and the one thing in the
// knowledge package that spends tokens. The loop closes in
// scripts/stack_learn.mjs: once a person ratifies a classification of a
// PUBLIC package, that script turns it into a table line for review, and
// the table knows the tool from the next release on.
//
// Pure except for docMentions (reads the project's own markdown) and
// applyClassifications (writes the constraint store). No model here: the
// spawn lives in scripts/cli/classify.mjs, so this module is testable with
// a canned reply.

import * as fs from "fs";
import * as path from "path";
import {
  ROLE_LABEL, STACK_ROLES, isSafeToolName, jstsPackageName, pythonToolName, type StackRole,
} from "../shared/stack_taxonomy.ts";
import type { StackIndex, StackTool } from "./stack.ts";
import { addConstraint, loadConstraints, type Constraint, type ConstraintInput } from "./constraint_store.ts";

// ── the dossier ──────────────────────────────────────────────────────────

export interface DossierImport { file: string; spec: string; names: string[]; line?: number }
export interface DossierCall { file: string; nodeId: string; target: string; preview?: string; line?: number }
export interface DossierDoc { file: string; line: number; text: string }

/** Everything the IR and the project's own docs say about one unknown tool. */
export interface ToolDossier {
  tool: string;
  language: string;
  origin: string;
  version?: string;
  files: string[];
  threads: string[];
  imports: DossierImport[];
  /** Call sites through the tool's import bindings, ONE hop of local
   *  binding followed (`client = new VoltClient(…)` → `client.command`),
   *  the M-RESOLVE rule. Capped; `callCounts` is over all of them. */
  calls: DossierCall[];
  callCounts: { target: string; count: number }[];
  docs: DossierDoc[];
}

interface EnvelopeLike {
  files: Record<string, { language?: unknown; nodes?: unknown[] }>;
}

export interface CollectOpts {
  /** the analysed project root; docs are read from it. Omit for none. */
  root?: string;
  maxCalls?: number;
  maxDocs?: number;
}

/** Roles a model may assign. `unknown` is the absence of a classification
 *  and `runtime` is the language's own standard library, never a third-party
 *  package. */
export const ASSIGNABLE_ROLES: readonly StackRole[] = STACK_ROLES.filter((r) => r !== "unknown" && r !== "runtime");

function packageOf(language: string, spec: string): string {
  if (language === "jsts") return jstsPackageName(spec);
  if (language === "python") return pythonToolName(spec);
  return spec;
}

function head(target: string): string {
  return target.split(".")[0] ?? target;
}

/** The unknown, non-project tools of an index, each with its dossier. */
export function collectUnknownTools(env: EnvelopeLike, stack: StackIndex, opts: CollectOpts = {}): ToolDossier[] {
  const maxCalls = opts.maxCalls ?? 30;
  const out: ToolDossier[] = [];
  const unknown = stack.tools.filter((t) => t.role === "unknown" && t.origin !== "project" && t.origin !== "stdlib");
  for (const t of unknown) {
    out.push(dossierFor(t, env, stack, { ...opts, maxCalls }));
  }
  return out;
}

function dossierFor(t: StackTool, env: EnvelopeLike, stack: StackIndex, opts: CollectOpts): ToolDossier {
  const files = [...t.files].sort();
  const language = files.map((f) => env.files[f]?.language).find((l) => typeof l === "string") as string | undefined ?? "unknown";
  const imports: DossierImport[] = [];
  const calls: DossierCall[] = [];
  const counts = new Map<string, number>();
  for (const f of files) {
    const ir = env.files[f];
    const nodes = (ir?.nodes ?? []) as Record<string, unknown>[];
    const lang = typeof ir?.language === "string" ? ir.language : language;
    // Import forms, from the evidence the index already keyed.
    for (const e of t.evidence) {
      if (e.file !== f || e.kind !== "import") continue;
      const n = nodes.find((x) => x.id === e.nodeId);
      if (!n) continue;
      const spec = typeof n.module === "string" ? n.module : Array.isArray(n.names) ? String(n.names[0] ?? t.tool) : t.tool;
      const names = Array.isArray(n.names) ? n.names.filter((x): x is string => typeof x === "string") : [];
      imports.push({ file: f, spec, names, line: typeof n.line === "number" ? n.line : undefined });
    }
    // The local names bound to the tool, then one hop of assignment.
    const bound = new Set<string>();
    for (const b of stack.importsByFile?.[f] ?? []) {
      if (b.project) continue;
      if (packageOf(lang, b.spec) === t.tool) bound.add(b.binding);
    }
    const locals = new Set<string>();
    for (const l of stack.localsByFile?.[f] ?? []) {
      if (l.callTarget && bound.has(head(l.callTarget))) locals.add(l.name);
    }
    for (const n of nodes) {
      const target = typeof n.callTarget === "string" ? n.callTarget : typeof n.funcName === "string" ? n.funcName : null;
      if (!target) continue;
      const h = head(target);
      // A bash command word IS the tool; a JS/Python call goes through a binding.
      const through = lang === "bash" ? target === t.tool : bound.has(h) || locals.has(h);
      if (!through) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
      if (calls.length < (opts.maxCalls ?? 30)) {
        calls.push({
          file: f, nodeId: String(n.id), target,
          preview: typeof n.preview === "string" ? n.preview.slice(0, 160) : undefined,
          line: typeof n.line === "number" ? n.line : undefined,
        });
      }
    }
  }
  const callCounts = [...counts.entries()].map(([target, count]) => ({ target, count })).sort((a, b) => b.count - a.count || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  return {
    tool: t.tool, language, origin: t.origin, version: t.version,
    files, threads: [...t.threads].sort(),
    imports, calls, callCounts,
    docs: opts.root ? docMentions(opts.root, t.tool, { maxLines: opts.maxDocs ?? 8 }) : [],
  };
}

// ── the project's own documentation ──────────────────────────────────────

const DOC_SKIP = new Set(["node_modules", ".git", ".next", "build", "dist", "out", "target", ".vibegraph", "venv", ".venv", "__pycache__"]);

/** Markdown at the root and up to two directories down (a monorepo keeps a
 *  CLAUDE.md per package), capped so a documentation-heavy tree cannot
 *  make this a crawl. */
export function docFiles(root: string, opts: { maxFiles?: number; depth?: number } = {}): string[] {
  const max = opts.maxFiles ?? 120;
  const depth = opts.depth ?? 2;
  const out: string[] = [];
  const walk = (dir: string, d: number): void => {
    if (out.length >= max) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.isDirectory()) {
        if (d < depth && !DOC_SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), d + 1);
        else if (d < depth && (e.name === "docs" || e.name === ".claude")) walk(path.join(dir, e.name), d + 1);
      } else if (e.isFile() && /\.(md|mdx|txt|rst)$/i.test(e.name)) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  walk(root, 0);
  return out;
}

/** Lines of the project's docs that name the tool — the exact name first,
 *  then (for a scoped package) its scope, so `@tdxvolt/volt-utility` still
 *  finds the paragraph that explains what a Volt is. */
export function docMentions(root: string, tool: string, opts: { maxLines?: number } = {}): DossierDoc[] {
  const max = opts.maxLines ?? 8;
  const exact: DossierDoc[] = [];
  const scoped: DossierDoc[] = [];
  const exactRe = mentionPattern(tool);
  // A REAL scope only (`@tdxvolt`): `@/lib` is a path alias whose "scope"
  // is a bare `@`, and the first dossier on a real codebase matched every
  // documentation line containing an `@` for it.
  const scopeName = /^@[^/]+\//.test(tool) ? tool.split("/")[0] : null;
  const scopeRe = scopeName ? mentionPattern(scopeName) : null;
  for (const abs of docFiles(root)) {
    let text: string;
    try {
      if (fs.statSync(abs).size > 512 * 1024) continue;
      text = fs.readFileSync(abs, "utf-8");
    } catch { continue; }
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (exactRe.test(lines[i])) {
        if (exact.length < max) exact.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 240) });
      } else if (scopeRe && scopeRe.test(lines[i]) && scoped.length < 3) {
        scoped.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 240) });
      }
    }
    if (exact.length >= max) break;
  }
  return [...exact, ...scoped.slice(0, Math.max(0, max - exact.length))];
}

/** The tool name as a WORD: `bc` must not match "BCN GROUP" or a commit
 *  hash, `zod` may still match "zod." — the boundary excludes the characters
 *  a package or command name can continue with. Case-insensitive. */
export function mentionPattern(name: string): RegExp {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_@/.\\-])${esc}(?![A-Za-z0-9_\\-])`, "i");
}

// ── the prompt ───────────────────────────────────────────────────────────

/** What a role does DOWNSTREAM — the part a classifier must weigh, because
 *  an I/O role given to a utility fabricates round trips in every loop. */
const ROLE_CONSEQUENCE: Partial<Record<StackRole, string>> = {
  "http-client": "every call counts as a network round trip",
  "model-api": "every call counts as a network round trip to a hosted model",
  platform: "every call counts as a network round trip to the platform",
  db: "every call counts as a database round trip",
  process: "every call counts as a subprocess",
  remote: "every call counts as a subprocess on another machine",
};

export function buildClassifyPrompt(dossiers: ToolDossier[], opts: { project?: string } = {}): string {
  const lines: string[] = [];
  lines.push(
    "You are classifying third-party tools that a static analyser could not place. For each tool below choose ONE role from the list, or say you are unsure.",
    "Answer from the EVIDENCE given — how this codebase imports and calls the tool, its manifest version, what the project's own documentation says — and from what you know of the package. Do not invent vendor facts for a package you do not know: say unsure and why. A private package can still be classified from its usage alone, and its definition should then say what the usage shows.",
    "Some of these may be this project's OWN code that the analyser failed to link — a local Python package imported across directories, a shell function defined in a file that is sourced through a variable. Those are not dependencies: put them in unsure with a reason beginning \"project code:\" and never give them a role.",
    "",
    "Roles (exactly these ids):",
  );
  for (const r of ASSIGNABLE_ROLES) {
    const c = ROLE_CONSEQUENCE[r];
    lines.push(`- ${r}: ${ROLE_LABEL[r]}${c ? ` — ${c}` : " — no effect derived"}`);
  }
  lines.push(
    "",
    "The role decides what the analyser derives: an I/O role (http-client, model-api, platform, db, process, remote) makes every call through the tool a round trip, which drives an N+1 warning inside loops. A library that does no I/O of its own must NOT be given an I/O role: a component, icon or chart library is frontend; a schema validator, parser, id generator, date formatter or in-process scheduler is utility; a build-time guard is build; a test runner is test; configuration or process plumbing is infra. `data` is for data-processing frameworks (pandas, numpy, a JSON processor over data streams), not for every library that touches data.",
    `platform means a backend platform behind ONE client — identity, policy, data and commands together (firebase, supabase, a Volt) — not a plain HTTP or database client.`,
    "",
    `Tools${opts.project ? ` in ${opts.project}` : ""}:`,
  );
  dossiers.forEach((d, i) => {
    lines.push("", `### ${i + 1}. ${d.tool} (${d.language}${d.version ? `; version ${d.version}` : ""}; ${d.files.length} file(s); ${d.threads.length} thread(s))`);
    if (d.imports.length) {
      const seen = new Set<string>();
      for (const im of d.imports) {
        const k = `${im.spec}|${im.names.join(",")}`;
        if (seen.has(k)) continue;
        seen.add(k);
        lines.push(`imports: ${im.file}: ${im.names.length ? `{ ${im.names.join(", ")} } from "${im.spec}"` : `"${im.spec}"`}`);
        if (seen.size >= 6) break;
      }
    }
    if (d.callCounts.length) lines.push(`calls (by target): ${d.callCounts.slice(0, 12).map((c) => `${c.target} ×${c.count}`).join(", ")}`);
    for (const c of d.calls.slice(0, 8)) lines.push(`  ${c.file}${c.line ? `:${c.line}` : ""} ${c.preview ? `\`${c.preview}\`` : c.target}`);
    if (!d.callCounts.length) lines.push("calls: none through its bindings (imported, or declared in a manifest, but no call the analyser could follow)");
    for (const doc of d.docs) lines.push(`docs: ${doc.file}:${doc.line}: ${doc.text}`);
    if (!d.docs.length) lines.push("docs: the project's own documentation does not mention it");
  });
  lines.push(
    "",
    "Reply with JSON only, no prose around it:",
    '{"classifications":[{"tool":"<exact tool name as listed>","role":"<role id>","confidence":"high|medium|low","definition":"<one sentence, at most 200 characters: what the tool IS and what this codebase uses it for>","why":"<the evidence that decided the role, at most 200 characters>"}],"unsure":[{"tool":"<exact tool name>","reason":"<why>"}]}',
    "Every tool listed above must appear in exactly one of the two arrays.",
  );
  return lines.join("\n");
}

// ── the reply ────────────────────────────────────────────────────────────

export interface Classification {
  tool: string;
  role: StackRole;
  confidence: "high" | "medium" | "low";
  definition: string;
  why: string;
}

export interface ParsedReply {
  accepted: Classification[];
  unsure: { tool: string; reason: string }[];
  /** items the reply gave that this module would not store, with why. */
  refused: { tool: string; reason: string }[];
  /** tools asked about that the reply left out entirely. */
  missing: string[];
  /** the reply was not JSON at all. */
  error?: string;
}

function clip(v: unknown, n: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, n) : "";
}

/** Validate a model's reply against what was ASKED: a tool not in the
 *  dossiers is refused (the model may not classify what it was not shown),
 *  a role outside the assignable set is refused, and nothing is coerced. */
export function parseClassifyResponse(text: string, dossiers: ToolDossier[]): ParsedReply {
  const asked = new Set(dossiers.map((d) => d.tool));
  const out: ParsedReply = { accepted: [], unsure: [], refused: [], missing: [] };
  let body = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  if (fence) body = fence[1].trim();
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b <= a) { out.error = "the reply contained no JSON object"; out.missing = [...asked]; return out; }
  let parsed: unknown;
  try { parsed = JSON.parse(body.slice(a, b + 1)); } catch (e) {
    out.error = `the reply's JSON did not parse: ${(e as Error).message}`; out.missing = [...asked]; return out;
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const placed = new Set<string>();
  for (const raw of Array.isArray(obj.classifications) ? obj.classifications : []) {
    const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const tool = clip(c.tool, 120);
    if (!isSafeToolName(tool)) { out.refused.push({ tool: tool || "?", reason: "not a tool name" }); continue; }
    if (!asked.has(tool)) { out.refused.push({ tool, reason: "not among the tools asked about" }); continue; }
    if (placed.has(tool)) { out.refused.push({ tool, reason: "listed twice; the first entry stands" }); continue; }
    const role = clip(c.role, 40) as StackRole;
    if (!ASSIGNABLE_ROLES.includes(role)) { out.refused.push({ tool, reason: `role "${role}" is not one of ${ASSIGNABLE_ROLES.join(", ")}` }); continue; }
    const definition = clip(c.definition, 300);
    if (!definition) { out.refused.push({ tool, reason: "no definition" }); continue; }
    const conf = clip(c.confidence, 10).toLowerCase();
    const confidence = conf === "high" || conf === "medium" || conf === "low" ? conf : "low";
    placed.add(tool);
    out.accepted.push({ tool, role, confidence, definition, why: clip(c.why, 300) });
  }
  for (const raw of Array.isArray(obj.unsure) ? obj.unsure : []) {
    const u = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const tool = clip(u.tool, 120);
    if (!asked.has(tool)) { out.refused.push({ tool: tool || "?", reason: "unsure about a tool not asked about" }); continue; }
    if (placed.has(tool)) continue;
    placed.add(tool);
    out.unsure.push({ tool, reason: clip(u.reason, 300) || "no reason given" });
  }
  out.missing = [...asked].filter((t) => !placed.has(t)).sort();
  return out;
}

// ── storing ──────────────────────────────────────────────────────────────

export interface ApplyMeta {
  /** the label of what classified — the model id, or the stub's name. */
  model: string;
  now?: () => Date;
}

/** The constraint one classification becomes. `describe` + `role` is what
 *  the stack index reads; `text` is the definition a reader sees; `note`
 *  carries the provenance and the two ways a person closes the loop. */
export function classificationInput(c: Classification, d: ToolDossier | undefined, meta: ApplyMeta): ConstraintInput {
  const sites = d?.callCounts.reduce((n, x) => n + x.count, 0) ?? 0;
  const files = d?.files.length ?? 0;
  const date = (meta.now ?? (() => new Date()))().toISOString().slice(0, 10);
  return {
    kind: "stack-policy",
    text: c.definition,
    scope: { stack: [c.tool] },
    note: `classified by ${meta.model} (agent — NOT human-reviewed) from ${sites} call site(s) in ${files} file(s), ${date}; confidence ${c.confidence}; language=${d?.language ?? "unknown"}. Ratify: set "source" to "human" (edit the text if it is wrong). Reject: delete this entry and the tool reads unclassified again.`,
    policy: { tool: c.tool, role: c.role, rule: "describe", reason: c.why || undefined },
  };
}

export interface ApplyResult {
  added: Constraint[];
  skipped: { tool: string; reason: string }[];
}

/** Store the accepted classifications as agent-stated constraints. A tool
 *  ANY existing stack-policy already gives a role — a person's, the
 *  orchestrator's, or an earlier pass's — is skipped: re-running never
 *  duplicates and never overrides, and deleting the entry is how a person
 *  asks for a fresh classification. */
export function applyClassifications(root: string, accepted: Classification[], dossiers: ToolDossier[], meta: ApplyMeta): ApplyResult {
  const byTool = new Map(dossiers.map((d) => [d.tool, d]));
  const result: ApplyResult = { added: [], skipped: [] };
  for (const c of accepted) {
    const existing = loadConstraints(root).find((k) => k.kind === "stack-policy" && k.policy?.tool === c.tool && k.policy.role);
    if (existing) {
      result.skipped.push({ tool: c.tool, reason: `already classified by ${existing.id} (${existing.source}-stated, ${existing.policy!.role})` });
      continue;
    }
    result.added.push(addConstraint(root, classificationInput(c, byTool.get(c.tool), meta), "agent", meta.now));
  }
  return result;
}

// ── reports ──────────────────────────────────────────────────────────────

export function formatDossierReport(dossiers: ToolDossier[]): string {
  if (!dossiers.length) return "No unclassified third-party tools: every tool the code imports or calls has a role from a table or a stated policy.\n";
  const lines = [`${dossiers.length} unclassified third-party tool(s) — what the IR and the project's docs say about each:`];
  for (const d of dossiers) {
    lines.push("", `${d.tool}  (${d.language}${d.version ? `, v${d.version}` : ""}; ${d.files.length} file(s), ${d.threads.length} thread(s))`);
    const seen = new Set<string>();
    for (const im of d.imports) {
      const k = `${im.spec}|${im.names.join(",")}`;
      if (seen.has(k)) continue;
      seen.add(k);
      lines.push(`  import ${im.names.length ? `{ ${im.names.join(", ")} }` : ""} from "${im.spec}"  (${im.file})`);
    }
    if (d.callCounts.length) lines.push(`  calls: ${d.callCounts.slice(0, 10).map((c) => `${c.target} ×${c.count}`).join(", ")}`);
    else lines.push("  calls: none the analyser could follow through its bindings");
    for (const doc of d.docs.slice(0, 4)) lines.push(`  docs: ${doc.file}:${doc.line}: ${doc.text.slice(0, 140)}`);
  }
  return lines.join("\n") + "\n";
}

export function formatReplyReport(parsed: ParsedReply, applied: ApplyResult | null): string {
  const lines: string[] = [];
  if (parsed.error) lines.push(`the model's reply could not be read: ${parsed.error}`);
  for (const c of parsed.accepted) lines.push(`${c.tool} → ${c.role} (${c.confidence}): ${c.definition}${c.why ? `  [${c.why}]` : ""}`);
  for (const u of parsed.unsure) lines.push(`${u.tool} → unsure: ${u.reason}`);
  for (const r of parsed.refused) lines.push(`refused ${r.tool}: ${r.reason}`);
  if (parsed.missing.length) lines.push(`not answered: ${parsed.missing.join(", ")}`);
  if (applied) {
    for (const a of applied.added) lines.push(`stored ${a.id}: ${a.policy!.tool} is classified as ${a.policy!.role} — agent-stated, NOT human-reviewed`);
    for (const s of applied.skipped) lines.push(`kept ${s.tool}: ${s.reason}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
