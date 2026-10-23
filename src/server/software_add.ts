// Drafting a software spec from its own documents, for the CLI's `software add`
// and the app's setup run (2026-10-21, Ben: "add a run all button"). One read
// of the docs, one model call, the citation gate (software_draft.ts) and the
// store, so the command and the app cannot disagree about what a draft keeps.
// The app passes only the docs link the setup found (software_candidates.ts),
// computed on the server: a client never names a URL or a path here.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { isInstalledReadme } from "./software_candidates.ts";
import { cacheDirFor } from "../../scripts/cache_dir.mjs";
import type { SoftwareSpec } from "../shared/software_types.ts";
import { buildSpecPrompt, gateSpec, htmlToText, parseSpecReply, specCoverage, thinSpecNote } from "./software_draft.ts";
import { isSafeTool, saveSource, saveSpec } from "./software_store.ts";
import { githubRef, readGithubDocs, type DocsRead } from "./github_docs.ts";
import { modelNothingText } from "./model_failure_state.ts";

const MAX_BYTES = 5 * 1024 * 1024;

/** One docs page over http(s), as readable text. A GitHub repository link is
 *  read through GitHub's API, with the person's login only where they granted
 *  it for that owner (github_docs.ts); `needs` says which grant would help. */
export async function fetchDocs(url: string, opts: { root?: string } = {}): Promise<DocsRead> {
  // 2026-10-22 — the README installed with the package, which the setup found
  // (software_candidates.ts): read from the project's node_modules, nothing else on disk
  if (opts.root && isInstalledReadme(url)) {
    const file = resolve(opts.root, url);
    if (!file.startsWith(resolve(opts.root, "node_modules") + sep)) return { error: `${url}: outside the project's node_modules` };
    try {
      const text = readFileSync(file, "utf-8");
      return text.length > MAX_BYTES ? { error: `${url}: over ${MAX_BYTES / 1024 / 1024} MB` } : { text };
    } catch { return { error: `${url}: not found` }; }
  }
  if (!/^https?:\/\//i.test(url)) return { error: `${url}: not an http(s) link` };
  const gh = githubRef(url);
  if (gh) return readGithubDocs(gh, { root: opts.root });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "vibegraph-knowledge (software spec)" } });
    if (!res.ok) return { error: `${url}: HTTP ${res.status}` };
    const body = await res.text();
    if (body.length > MAX_BYTES) return { error: `${url}: over ${MAX_BYTES / 1024 / 1024} MB` };
    const html = /html/i.test(res.headers.get("content-type") ?? "") || /^\s*<(!doctype|html)/i.test(body);
    return { text: html ? htmlToText(body) : body };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return { error: `${url}: ${err.name === "AbortError" ? "timed out" : err.message}` };
  } finally { clearTimeout(timer); }
}

/** A model's reply parsed, gated against the documents, and saved as a DRAFT. */
export function gateAndSaveSpec(root: string, tool: string, texts: Array<{ ref: string; text: string }>, reply: string, by: string):
  { spec: SoftwareSpec; dropped: string[]; inferred: string[] } | { error: string } {
  const p = parseSpecReply(reply);
  if (p.error) return { error: p.error };
  const sources = texts.map((t) => saveSource(root, tool, t.ref, t.text));
  const g = gateSpec(p.value, tool, sources, texts.map((t) => t.text), by);
  if (g.error || !g.spec) return { error: g.error ?? "the gate kept nothing" };
  const saved = saveSpec(root, g.spec);
  if (saved.error) return { error: saved.error };
  return { spec: g.spec, dropped: g.dropped, inferred: g.inferred };
}

/** Where a refused reply is kept, so a re-run with `--reply` spends nothing. */
export function keptReplyPath(root: string, tool: string): string {
  return join(cacheDirFor(root), "software-replies", `${tool}.txt`);
}

/** The app's `software add`: read the docs, one model call, gate, save a draft. */
export async function softwareAddRun(root: string, tool: string, urls: string[], run: (prompt: string) => Promise<string | null>, by: string,
  step: (text: string) => void = () => {}): Promise<{ ok: boolean; error?: string; detail?: string; needs?: { github: string } }> {
  if (!isSafeTool(tool)) return { ok: false, error: `${tool}: not a tool name` };
  const texts: Array<{ ref: string; text: string }> = [];
  for (const url of urls) {
    step(`reading ${url}`);
    const r = await fetchDocs(url, { root });
    if (r.error) return { ok: false, error: `could not read ${r.error}`, ...(r.needs ? { needs: r.needs } : {}) };
    if (!r.text?.trim()) return { ok: false, error: `${url} has no text` };
    texts.push({ ref: url, text: r.text });
  }
  const reply = await run(buildSpecPrompt(tool, texts));
  if (reply === null) return { ok: false, error: modelNothingText() };
  const r = gateAndSaveSpec(root, tool, texts, reply, by);
  if ("error" in r) {
    const file = keptReplyPath(root, tool);
    try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, reply); } catch { /* the refusal still stands */ }
    return { ok: false, error: `${tool}: ${r.error} (the reply is kept: vibegraph-knowledge software add ${tool} ${urls.map((u) => `--from ${u}`).join(" ")} --reply ${file})` };
  }
  const cov = specCoverage(r.spec);
  return { ok: true, detail: `${tool}: a draft spec, ${r.spec.operations.length} operations and ${r.spec.rules.length} rules, ${r.dropped.length} dropped by the citation gate${cov.thin ? `; ${thinSpecNote(tool, cov)}` : ""}` };
}
