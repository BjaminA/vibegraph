// GENERATED DOCUMENTS that go stale visibly (2026-10-01). A project often
// keeps documents a command derives — an architecture page, an API reference,
// a schema dump — and nothing says when they stopped describing the code.
// `.vibegraph/docs.json` registers each: its path, the command that
// generates it, and the inputs it is derived from (paths, folders, globs).
//
// Staleness is read from git, never guessed: the document's last generation
// is its last commit; it is STALE SINCE the first later commit that changed
// an input — or since the working tree, when an input changed and is not yet
// committed while the document did not. A document git does not track cannot
// be judged, and says so. Zero tokens; the generator is never run here.
//
// 2026-10-02 — and by CONTENT once stamped: a regeneration that comes out
// byte-identical leaves git nothing to see, so a commit-based reading said
// "stale" for ever. `docs stamp <path>` (a person, after regenerating) records
// the hash of the document and of its inputs' content; while both match it is
// fresh whatever the history says, and an input changed since is stale since
// the stamp.

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { inputsHash } from "./topology_store.ts";
import { createHash } from "crypto";

export const DOCS_FILE = path.join(".vibegraph", "docs.json");

export interface GeneratedDoc {
  path: string;
  /** the command that regenerates it (shown, never run) */
  generator: string;
  /** what it is derived from: files, folders (trailing /), globs */
  inputs: string[];
  note?: string;
  /** set by `docs stamp`: the content it was regenerated from */
  stamp?: { docHash: string; inputsHash: string; at: string };
}

export interface DocStatus {
  doc: GeneratedDoc;
  state: "fresh" | "stale" | "unknown";
  /** stale: the first commit after the doc's that changed an input, or "the working tree" */
  since?: string;
  /** stale: which inputs changed */
  changed?: string[];
  detail: string;
}

const line = (x: unknown, max = 240) => typeof x === "string" && x.trim().length > 0 && x.length <= max && !x.includes("\n");

export function validateDoc(x: unknown): string | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return "a doc must be an object";
  const d = x as Record<string, unknown>;
  if (!line(d.path) || path.isAbsolute(String(d.path)) || String(d.path).includes("..")) return "path must be the document's path inside the project";
  if (!line(d.generator, 400)) return "generator must be the command that regenerates it";
  if (!Array.isArray(d.inputs) || !d.inputs.length || d.inputs.length > 20 || !d.inputs.every((i) => line(i) && !String(i).includes(".."))) return "inputs must list 1–20 paths, folders or globs it is derived from";
  if (d.note !== undefined && !line(d.note)) return "note must be one line";
  return null;
}

export function loadDocs(root: string): GeneratedDoc[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, DOCS_FILE), "utf-8"));
    const list = Array.isArray(raw?.docs) ? raw.docs : [];
    return list.filter((d: unknown) => validateDoc(d) === null);
  } catch { return []; }
}

export function saveDocs(root: string, docs: GeneratedDoc[]): void {
  const file = path.join(root, DOCS_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: "1", docs }, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}

const git = (root: string, args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** A git pathspec for an input: a glob as a glob, a folder as itself. */
const spec = (i: string) => (/[*?[]/.test(i) ? `:(glob)${i}` : i.replace(/\/$/, ""));

const fileHash = (root: string, rel: string) => {
  try { return createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex"); } catch { return null; }
};

/** The stamp a person records after regenerating a document. */
export function stampOf(root: string, doc: GeneratedDoc, now: Date = new Date()): GeneratedDoc["stamp"] | null {
  const docHash = fileHash(root, doc.path);
  return docHash ? { docHash, inputsHash: inputsHash(root, doc.inputs).hash, at: now.toISOString() } : null;
}

export function docStatus(root: string, doc: GeneratedDoc): DocStatus {
  if (doc.stamp) {
    const docNow = fileHash(root, doc.path);
    const inNow = inputsHash(root, doc.inputs).hash;
    if (docNow === doc.stamp.docHash && inNow === doc.stamp.inputsHash) {
      return { doc, state: "fresh", detail: `stamped ${doc.stamp.at.slice(0, 16)}; neither it nor its inputs changed since (by content)` };
    }
    if (docNow === doc.stamp.docHash) {
      return { doc, state: "stale", since: `the stamp of ${doc.stamp.at.slice(0, 16)}`, detail: `stale: its inputs changed since it was stamped (${doc.stamp.at.slice(0, 16)}) — regenerate (\`${doc.generator}\`), then \`docs stamp ${doc.path}\`` };
    }
    // the document itself changed since the stamp: read the history as usual
  }
  let docCommit = "";
  try { docCommit = git(root, ["log", "-1", "--format=%h", "--", doc.path]); }
  catch { return { doc, state: "unknown", detail: "not a git repository — staleness is read from git history" }; }
  if (!docCommit) return { doc, state: "unknown", detail: `${doc.path} has never been committed — cannot tell when it was generated` };
  const inputs = doc.inputs.map(spec);
  const later = git(root, ["log", "--reverse", "--format=%h", `${docCommit}..HEAD`, "--", ...inputs]).split("\n").filter(Boolean);
  if (later.length) {
    const changed = git(root, ["diff", "--name-only", `${docCommit}..HEAD`, "--", ...inputs]).split("\n").filter(Boolean);
    return { doc, state: "stale", since: later[0], changed, detail: `stale since ${later[0]}: ${changed.slice(0, 4).join(", ")}${changed.length > 4 ? ` +${changed.length - 4} more` : ""} changed after ${doc.path} was generated (${docCommit}) — regenerate: ${doc.generator}` };
  }
  const dirtyInputs = git(root, ["status", "--porcelain", "--", ...inputs]).split("\n").filter(Boolean).map((l) => l.slice(3));
  const docDirty = git(root, ["status", "--porcelain", "--", doc.path]).length > 0;
  if (dirtyInputs.length && !docDirty) {
    return { doc, state: "stale", since: "the working tree", changed: dirtyInputs, detail: `stale: ${dirtyInputs.slice(0, 4).join(", ")} changed in the working tree since ${doc.path} was generated (${docCommit}) — regenerate: ${doc.generator}` };
  }
  return { doc, state: "fresh", detail: `generated at ${docCommit}${docDirty ? " (regenerated in the working tree)" : ""}; no input changed since` };
}

export function docsStatus(root: string): DocStatus[] {
  return loadDocs(root).map((d) => docStatus(root, d));
}
