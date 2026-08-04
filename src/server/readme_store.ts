// Dynamic-README store (M20.1, PLAN-v5 §2). On-disk, OUT of the IR —
// READMEs are regenerable context anchors, not parsed facts. Per-thread
// and per-file summaries live under `<root>/.vibegraph/readmes/` with a
// frontmatter `sourceHash` recording the IR they were written against;
// staleness is a hash comparison computed at read time (no separate
// aggregator pass — PLAN-v5 §2.2). Generation (writing bodies via the
// agent) is M20.2; this module is the store + staleness foundation.
//
// Pure node builtins, no runtime state — every function takes the project
// root, so it unit-tests against a temp dir.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ReadmeScope = "thread" | "file";

export interface StoredReadme {
  key: string;
  scope: ReadmeScope;
  id: string;
  body: string;
  sourceHash: string;
  generatedAt: string;
}

export type ReadmeResult =
  | (StoredReadme & { exists: true; stale: boolean })
  | { exists: false; key: string; scope: ReadmeScope; id: string };

// ── keys ──────────────────────────────────────────────────────────────
// Canonical key string: `<scope>:<id>`. id is an entryPointId (thread) or
// a project-relative file path (file) — both may themselves contain ':'
// or '/', so parse on the FIRST colon only.

export function canonicalKey(scope: ReadmeScope, id: string): string {
  return `${scope}:${id}`;
}

export function parseKey(key: string): { scope: ReadmeScope; id: string } {
  const i = key.indexOf(":");
  const scope = key.slice(0, i) as ReadmeScope;
  return { scope, id: key.slice(i + 1) };
}

// ── hashing ───────────────────────────────────────────────────────────
// Stable (sorted-key) JSON so the hash is invariant to key ordering, then
// sha256. This is the "IR the README was written against" fingerprint:
// when a thread's nodes/filesReached change (M8.3 re-extraction) or a
// file's IR changes, the hash diverges and the README reads stale.

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function sourceHashOf(ir: unknown): string {
  return "sha256:" + createHash("sha256").update(stableStringify(ir)).digest("hex");
}

// ── disk layout ───────────────────────────────────────────────────────

function slug(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function readmePath(root: string, scope: ReadmeScope, id: string): string {
  const dir = scope === "thread" ? "threads" : "files";
  return join(root, ".vibegraph", "readmes", dir, `${slug(id)}.md`);
}

// ── frontmatter (minimal; no YAML dep) ────────────────────────────────

function serialize(r: StoredReadme): string {
  return [
    "---",
    `key: ${r.key}`,
    `scope: ${r.scope}`,
    `id: ${r.id}`,
    `sourceHash: ${r.sourceHash}`,
    `generatedAt: ${r.generatedAt}`,
    "---",
    "",
    r.body.trim(),
    "",
  ].join("\n");
}

function parse(text: string): StoredReadme | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const header = text.slice(3, end).trim();
  const body = text.slice(end + 4).trim();
  const fm: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!fm.scope || !fm.id || !fm.sourceHash) return null;
  return {
    key: fm.key ?? canonicalKey(fm.scope as ReadmeScope, fm.id),
    scope: fm.scope as ReadmeScope,
    id: fm.id,
    sourceHash: fm.sourceHash,
    generatedAt: fm.generatedAt ?? "",
    body,
  };
}

// ── read / write ──────────────────────────────────────────────────────

export function writeReadme(
  root: string,
  scope: ReadmeScope,
  id: string,
  body: string,
  sourceHash: string,
  generatedAt: string,
): string {
  const p = readmePath(root, scope, id);
  mkdirSync(dirname(p), { recursive: true });
  const record: StoredReadme = { key: canonicalKey(scope, id), scope, id, body, sourceHash, generatedAt };
  writeFileSync(p, serialize(record));
  return p;
}

export function readStored(root: string, scope: ReadmeScope, id: string): StoredReadme | null {
  const p = readmePath(root, scope, id);
  if (!existsSync(p)) return null;
  try { return parse(readFileSync(p, "utf-8")); }
  catch { return null; }
}

// High-level read: returns the stored README tagged with staleness
// (stored.sourceHash !== the IR's current hash), or a well-formed
// not-generated result.
export function getReadme(
  root: string,
  scope: ReadmeScope,
  id: string,
  currentHash: string,
): ReadmeResult {
  const stored = readStored(root, scope, id);
  if (!stored) return { exists: false, key: canonicalKey(scope, id), scope, id };
  return { ...stored, exists: true, stale: stored.sourceHash !== currentHash };
}
