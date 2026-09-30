// The INVESTIGATION BOARD (2026-09-29, from the flowsint comparison): a
// person pins the nodes a bug touches — from as many threads as it crosses —
// writes what they found beside each, and hands the lot to an agent as one
// document. Stored per project in `.vibegraph/investigations/<name>.json`
// (committed or not, the person's call); the handoff is Markdown the export
// bundle carries and an agent reads with no VibeGraph.
//
// A pin is an ADDRESS (file + IR node id), never a copy of the code: the
// handoff reads the source at render time, and a pin whose node no longer
// exists says so instead of showing yesterday's lines.
//
// Pure except for the store functions at the bottom, which take the root.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const INVESTIGATIONS_DIR = join(".vibegraph", "investigations");
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_PINS = 64;
const MAX_NOTE = 4000;
const CONTEXT_LINES = 4;
const SPAN_CAP = 60;

export interface InvestigationPin {
  file: string;
  irNodeId: string;
  label: string;
  kind?: string;
  /** the thread the pin was taken from; null when pinned outside a thread */
  entryPointId: string | null;
  note: string;
  addedAt: string;
}

export interface Investigation {
  version: 1;
  name: string;
  /** what is being investigated, in the person's words */
  question: string;
  pins: InvestigationPin[];
  createdAt: string;
  updatedAt: string;
}

export function validInvestigationName(name: unknown): name is string {
  return typeof name === "string" && NAME.test(name);
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const safeRel = (f: unknown) => typeof f === "string" && f.length > 0 && f.length < 1024 && !f.startsWith("/") && !f.split(/[\\/]/).includes("..");

/** Validate at the boundary: a malformed field is refused, never coerced
 *  into something the person did not write. */
export function parseInvestigation(raw: unknown): { ok: true; value: Investigation } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "an investigation is an object" };
  const r = raw as Record<string, unknown>;
  if (!validInvestigationName(r.name)) return { ok: false, error: "name must be 1-64 of a-z 0-9 _ - (starting with a letter or digit)" };
  if (!Array.isArray(r.pins)) return { ok: false, error: "pins must be an array" };
  if (r.pins.length > MAX_PINS) return { ok: false, error: `at most ${MAX_PINS} pins` };
  const pins: InvestigationPin[] = [];
  for (const [i, p] of r.pins.entries()) {
    const q = (p ?? {}) as Record<string, unknown>;
    if (!safeRel(q.file)) return { ok: false, error: `pin ${i + 1}: file must be a project-relative path` };
    if (typeof q.irNodeId !== "string" || !q.irNodeId) return { ok: false, error: `pin ${i + 1}: irNodeId is required` };
    if (typeof q.note === "string" && q.note.length > MAX_NOTE) return { ok: false, error: `pin ${i + 1}: a note is at most ${MAX_NOTE} characters` };
    pins.push({
      file: q.file as string, irNodeId: q.irNodeId.slice(0, 512), label: str(q.label, 200) || q.irNodeId,
      ...(typeof q.kind === "string" ? { kind: q.kind.slice(0, 32) } : {}),
      entryPointId: typeof q.entryPointId === "string" && q.entryPointId ? q.entryPointId.slice(0, 512) : null,
      note: str(q.note, MAX_NOTE), addedAt: str(q.addedAt, 40) || new Date().toISOString(),
    });
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    value: {
      version: 1, name: r.name, question: str(r.question, MAX_NOTE), pins,
      createdAt: str(r.createdAt, 40) || now, updatedAt: now,
    },
  };
}

// ── the handoff ─────────────────────────────────────────────────────────────

interface HandoffNode { id?: string; type?: string; name?: string; parentId?: string | null; line?: number; endLine?: number; decoratorLine?: number }

export interface HandoffInput {
  inv: Investigation;
  files: Record<string, { nodes?: ReadonlyArray<HandoffNode> }>;
  readSource: (relFile: string) => string | null;
  /** optional: an entry point's one-line label, for "pinned on …" */
  threadLabel?: (entryPointId: string) => string | null;
}

function enclosingFunction(nodes: ReadonlyArray<HandoffNode>, node: HandoffNode): HandoffNode | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = node.parentId ? byId.get(node.parentId) : undefined;
  while (cur) {
    if (cur.type === "function_def") return cur;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

/** The pin's code: a definition's own span (capped), else the call with a
 *  few lines around it, the pinned lines marked. */
function excerpt(lines: string[], node: HandoffNode): { from: number; to: number; text: string } {
  const isDef = node.type === "function_def" || node.type === "class_def" || node.type === "module";
  const start = isDef ? (node.decoratorLine ?? node.line!) : Math.max(1, node.line! - CONTEXT_LINES);
  const end0 = node.type === "module" ? lines.length
    : isDef ? (node.endLine ?? node.line!) : Math.min(lines.length, (node.endLine ?? node.line!) + CONTEXT_LINES);
  const end = Math.min(end0, start + SPAN_CAP - 1, lines.length);
  const width = String(end).length;
  const out: string[] = [];
  for (let l = start; l <= end; l++) {
    const mark = !isDef && l >= node.line! && l <= (node.endLine ?? node.line!) ? ">" : " ";
    out.push(`${mark} ${String(l).padStart(width)}  ${lines[l - 1] ?? ""}`);
  }
  if (end < end0) out.push(`  … ${end0 - end} more line${end0 - end === 1 ? "" : "s"}`);
  return { from: start, to: end, text: out.join("\n") };
}

export function renderHandoff(input: HandoffInput): string {
  const { inv } = input;
  const threads = [...new Set(inv.pins.map((p) => p.entryPointId).filter((x): x is string => !!x))];
  const out: string[] = [
    `# Investigation: ${inv.name}`,
    "",
    "A person pinned these nodes while investigating, and wrote the notes. The notes are THEIR reading, not verified fact; the code under each pin is read from disk now, and a pin whose node no longer exists says so.",
    "",
    "## The question",
    "",
    inv.question.trim() || "(no question written)",
    "",
    `${inv.pins.length} pin${inv.pins.length === 1 ? "" : "s"} across ${threads.length} thread${threads.length === 1 ? "" : "s"}${threads.length ? `: ${threads.map((t) => `\`${t}\``).join(", ")}` : ""}. Updated ${inv.updatedAt.slice(0, 16).replace("T", " ")}.`,
  ];
  const cache = new Map<string, string[] | null>();
  inv.pins.forEach((p, i) => {
    const nodes = input.files[p.file]?.nodes ?? [];
    // "module" is a script-seeded thread's seed — the whole file, which no IR
    // node carries; it must not read as "the code moved".
    const node = p.irNodeId === "module" ? { id: "module", type: "module", line: 1 } as HandoffNode : nodes.find((n) => n.id === p.irNodeId);
    out.push("", `## ${i + 1}. \`${p.label}\` — ${p.file}${node?.line ? `:${node.line}` : ""}`, "");
    const from = p.entryPointId ? `pinned on the thread \`${p.entryPointId}\`${input.threadLabel?.(p.entryPointId) ? ` (${input.threadLabel(p.entryPointId)})` : ""}` : "pinned outside a thread";
    const fn = node ? enclosingFunction(nodes, node) : null;
    out.push(`${p.kind ? `${p.kind}, ` : ""}${from}${fn?.name ? `; inside \`${fn.name}\`` : ""}. IR node \`${p.irNodeId}\`.`);
    if (p.note.trim()) out.push("", "Note:", "", ...p.note.trim().split("\n").map((l) => `> ${l}`));
    if (!node || typeof node.line !== "number") {
      out.push("", `_The node is not in the current IR — the code moved, was renamed or deleted since this pin. Search \`${p.file}\` for \`${p.label}\`._`);
      return;
    }
    if (!cache.has(p.file)) cache.set(p.file, input.readSource(p.file)?.split("\n") ?? null);
    const lines = cache.get(p.file);
    if (!lines) { out.push("", `_${p.file} could not be read._`); return; }
    const x = excerpt(lines, node);
    out.push("", `\`\`\`text\n${x.text}\n\`\`\``);
  });
  out.push("", "## How to use this", "", "Start from the question, read each pin's note against its code, and check a claim in a note before relying on it. Each pin's thread has a contract (`contracts/` in the export, or `vibegraph_thread_contract`) naming what it calls and where it leaves the project.");
  return out.join("\n") + "\n";
}

// ── the WS surface (one function, so server.ts only routes) ─────────────────

export interface InvestigationReply {
  list: ReturnType<typeof listInvestigations>;
  current?: Investigation | null;
  handoff?: { name: string; path: string; text: string };
  error?: string;
}

export function handleInvestigation(
  root: string,
  msg: { type: string; payload?: any },
  ctx: { files: HandoffInput["files"]; threadLabel?: HandoffInput["threadLabel"] },
): InvestigationReply {
  const name = msg.payload?.name;
  const reply = (extra: Partial<InvestigationReply> = {}): InvestigationReply => ({ list: listInvestigations(root), ...extra });
  switch (msg.type) {
    case "investigation-list":
      return reply();
    case "investigation-get":
      return validInvestigationName(name) ? reply({ current: readInvestigation(root, name) }) : reply({ error: "invalid name" });
    case "investigation-save": {
      const r = writeInvestigation(root, msg.payload?.investigation);
      return r.ok ? reply({ current: r.value }) : reply({ error: r.error });
    }
    case "investigation-delete":
      return deleteInvestigation(root, name) ? reply({ current: null }) : reply({ error: `no investigation named ${String(name)}` });
    case "investigation-handoff": {
      const inv = validInvestigationName(name) ? readInvestigation(root, name) : null;
      if (!inv) return reply({ error: `no investigation named ${String(name)}` });
      const text = renderHandoff({ inv, files: ctx.files, threadLabel: ctx.threadLabel, readSource: (f) => readRel(root, f) });
      const rel = join(INVESTIGATIONS_DIR, `${inv.name}.md`);
      writeFileSync(join(root, rel), text);
      return reply({ current: inv, handoff: { name: inv.name, path: rel, text } });
    }
    default:
      return reply({ error: `unknown message ${msg.type}` });
  }
}

export function readRel(root: string, rel: string): string | null {
  if (!safeRel(rel)) return null;
  try { return readFileSync(join(root, rel), "utf-8"); } catch { return null; }
}

// ── the store ───────────────────────────────────────────────────────────────

const pathOf = (root: string, name: string) => join(root, INVESTIGATIONS_DIR, `${name}.json`);

export function listInvestigations(root: string): Array<{ name: string; question: string; pins: number; updatedAt: string }> {
  const dir = join(root, INVESTIGATIONS_DIR);
  if (!existsSync(dir)) return [];
  const out: Array<{ name: string; question: string; pins: number; updatedAt: string }> = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const inv = readInvestigation(root, f.slice(0, -5));
    if (inv) out.push({ name: inv.name, question: inv.question, pins: inv.pins.length, updatedAt: inv.updatedAt });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readInvestigation(root: string, name: string): Investigation | null {
  if (!validInvestigationName(name)) return null;
  try {
    const parsed = parseInvestigation(JSON.parse(readFileSync(pathOf(root, name), "utf-8")));
    if (!parsed.ok) return null;
    // keep the stored updatedAt: reading is not an update
    const raw = JSON.parse(readFileSync(pathOf(root, name), "utf-8"));
    return { ...parsed.value, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : parsed.value.updatedAt };
  } catch {
    return null;
  }
}

export function writeInvestigation(root: string, raw: unknown): { ok: true; value: Investigation } | { ok: false; error: string } {
  const parsed = parseInvestigation(raw);
  if (!parsed.ok) return parsed;
  const prior = readInvestigation(root, parsed.value.name);
  const value = { ...parsed.value, createdAt: prior?.createdAt ?? parsed.value.createdAt };
  mkdirSync(join(root, INVESTIGATIONS_DIR), { recursive: true });
  const p = pathOf(root, value.name);
  writeFileSync(`${p}.tmp`, JSON.stringify(value, null, 2) + "\n");
  renameSync(`${p}.tmp`, p);
  return { ok: true, value };
}

export function deleteInvestigation(root: string, name: string): boolean {
  if (!validInvestigationName(name)) return false;
  const p = pathOf(root, name);
  if (!existsSync(p)) return false;
  rmSync(p);
  return true;
}
