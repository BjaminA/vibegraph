// M-RUN2.3 — example data-file synthesis for "run to this node".
//
// When a thread reads a data file that doesn't exist yet, ask Claude
// (one-shot, headless) to draft a SMALL plausible example file from the
// READER's own source — so the file matches what the code actually parses.
// SAFETY: this only PROPOSES content. The gate shows every byte; consent is
// bound to the content hash (effect_consent.ts verifyDataConsent); and the
// file is only ever written into the run SANDBOX copy — never the real
// tree. VG_CLAUDE_BIN stub in automation (M10R.7).

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveClaudeBin } from "./synth_args.ts";

const MAX_BYTES = 16 * 1024;
const MAX_LINES = 100;

// Schema evidence beyond the reader function itself (sitting-3): the pump-lab
// holdout run failed because the drafter saw ONLY `evaluate_holdout` — the
// 9-column contract lived one hop away (`_rows_to_tensors`) and in the
// sibling `data/pump.csv`. Both are deterministic project facts the server
// already has; feeding them in changes nothing about the consent surface
// (every drafted byte is still shown and hash-bound).
export interface DataSynthContext {
  /** Real data files in the missing file's own directory: the strongest
      schema evidence. `sample` = the first few lines, verbatim. */
  siblings?: Array<{ path: string; sample: string; totalLines: number }>;
  /** Project functions the reader calls (one hop) — they define what the
      file must parse as. */
  helpers?: Array<{ name: string; source: string }>;
}

// Exported for direct unit tests (test/synth_data_prompt.test.mjs).
export function buildPrompt(relPath: string, readerSource: string, context?: DataSynthContext): string {
  const lines = [
    `You are drafting a SMALL example data file at "${relPath}" so a Python code path that reads it can be exercised.`,
    "The code that reads the file:",
    "```python",
    readerSource,
    "```",
  ];
  if (context?.helpers?.length) {
    lines.push(
      "Project helper functions the reader calls — they define what the file must parse as:",
      "```python",
      context.helpers.map((h) => h.source).join("\n\n"),
      "```",
    );
  }
  if (context?.siblings?.length) {
    lines.push("Real data files in the SAME directory (the strongest schema evidence):");
    for (const s of context.siblings) {
      lines.push(`--- ${s.path} (first lines of ${s.totalLines}) ---`, s.sample);
    }
  }
  lines.push(
    "Rules:",
    `- Output ONLY the raw file content — no explanation, no code fence, no leading blank line.`,
    `- At most ${MAX_LINES} lines. Plain text only (never binary).`,
    "- Make the content structurally consistent with how the code parses it (headers, column counts, value ranges).",
    "- If a sibling file's format matches what the reader parses, REPLICATE its schema exactly (same header, same column count) with fresh values.",
    "- Representative normal values, not edge cases.",
  );
  return lines.join("\n");
}

const SIBLING_MAX_FILES = 3;
const SIBLING_MAX_LINES = 5;
const SIBLING_MAX_LINE_CHARS = 200;
const SIBLING_MAX_BYTES = 1024 * 1024;
const HELPER_MAX = 5;
const HELPER_MAX_LINES = 60;

// Sample the missing file's own directory for real data files. Text-sniffed
// (control bytes in the head → skipped), size-capped, same-extension files
// first so a `data/pump.csv` outranks a stray readme when `data/holdout.csv`
// is being drafted. Returns [] when the directory doesn't exist yet.
export function collectSiblingSamples(
  rootAbs: string,
  relPath: string,
): NonNullable<DataSynthContext["siblings"]> {
  const rel = relPath.replace(/\\/g, "/");
  const dirRel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const dirAbs = path.join(rootAbs, dirRel);
  const wantExt = path.extname(rel);
  let entries: string[];
  try {
    entries = fs.readdirSync(dirAbs);
  } catch {
    return [];
  }
  const candidates = entries
    .filter((e) => {
      try { return fs.statSync(path.join(dirAbs, e)).isFile(); } catch { return false; }
    })
    .sort((a, b) => {
      const aExt = path.extname(a) === wantExt ? 0 : 1;
      const bExt = path.extname(b) === wantExt ? 0 : 1;
      return aExt - bExt || a.localeCompare(b);
    });
  const out: NonNullable<DataSynthContext["siblings"]> = [];
  for (const e of candidates) {
    if (out.length >= SIBLING_MAX_FILES) break;
    const abs = path.join(dirAbs, e);
    try {
      if (fs.statSync(abs).size > SIBLING_MAX_BYTES) continue;
      const text = fs.readFileSync(abs, "utf-8");
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text.slice(0, 2048))) continue; // binary
      const all = text.split("\n");
      const sample = all
        .slice(0, SIBLING_MAX_LINES)
        .map((l) => (l.length > SIBLING_MAX_LINE_CHARS ? l.slice(0, SIBLING_MAX_LINE_CHARS) + "…" : l))
        .join("\n");
      if (sample.trim().length === 0) continue;
      out.push({ path: dirRel ? `${dirRel}/${e}` : e, sample, totalLines: all.length });
    } catch { /* unreadable → skip */ }
  }
  return out;
}

export interface HelperDef { file: string; line: number; endLine: number }

// Resolve call-shaped names in the reader's source against the project's
// function defs (provided as a map — the server owns IR state) and read each
// one's source via the injected snippet reader. One hop, appearance order,
// capped; the reader's own def is excluded.
export function collectHelperSources(
  readerSource: string,
  defs: Map<string, HelperDef>,
  readSnippet: (file: string, line: number, endLine: number) => string,
): NonNullable<DataSynthContext["helpers"]> {
  const selfName = /^\s*def\s+([A-Za-z_]\w*)/m.exec(readerSource)?.[1];
  const seen = new Set<string>();
  const out: NonNullable<DataSynthContext["helpers"]> = [];
  for (const m of readerSource.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = m[1];
    if (name === selfName || seen.has(name)) continue;
    seen.add(name);
    const def = defs.get(name);
    if (!def) continue; // builtins / externals don't resolve — skipped
    let source = "";
    try { source = readSnippet(def.file, def.line, def.endLine); } catch { /* skip */ }
    if (!source.trim()) continue;
    const lines = source.split("\n");
    if (lines.length > HELPER_MAX_LINES) {
      source = lines.slice(0, HELPER_MAX_LINES).join("\n") + "\n    # … truncated";
    }
    out.push({ name, source });
    if (out.length >= HELPER_MAX) break;
  }
  return out;
}

export interface DataSynthResult {
  content: string | null;
  error?: string;
}

export function synthesizeDataFile(relPath: string, readerSource: string, cwd: string, context?: DataSynthContext): Promise<DataSynthResult> {
  const prompt = buildPrompt(relPath, readerSource, context);
  // Model tier: routine — mechanical example file.
  const { cmd, args: pre } = resolveClaudeBin("routine");
  return new Promise((resolve) => {
    const child = spawn(
      cmd,
      [...pre, "-p", "--output-format", "json", "--strict-mcp-config",
        "--mcp-config", '{"mcpServers":{}}',
        "--dangerously-skip-permissions", "--", prompt],
      { cwd, env: { ...process.env } },
    );
    child.stdin?.end();
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
    child.stderr.on("data", (b: Buffer) => { err += b.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        const first = err.split("\n").find((l) => l.trim()) ?? `exit ${code}`;
        resolve({ content: null, error: `claude -p exited ${code}: ${first}` });
        return;
      }
      let text = "";
      try {
        const parsed = JSON.parse(out);
        text = typeof parsed.result === "string" ? parsed.result : "";
      } catch {
        resolve({ content: null, error: `could not parse claude -p envelope: ${out.slice(0, 200)}` });
        return;
      }
      // Strip an accidental fence; then hard caps + printable-only.
      const m = text.trim().match(/^```[\w-]*\s*\n?([\s\S]*?)\n?```$/);
      const content = (m ? m[1] : text).replace(/\s+$/, "") + "\n";
      if (content.trim().length === 0) { resolve({ content: null, error: "model returned empty content" }); return; }
      if (Buffer.byteLength(content, "utf-8") > MAX_BYTES) {
        resolve({ content: null, error: `content too large (> ${MAX_BYTES} bytes)` });
        return;
      }
      if (content.split("\n").length > MAX_LINES + 1) {
        resolve({ content: null, error: `content too long (> ${MAX_LINES} lines)` });
        return;
      }
      // Printable-only: refuse control chars other than \n\t (binary honesty).
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) {
        resolve({ content: null, error: "content contains non-printable bytes — refusing binary" });
        return;
      }
      resolve({ content });
    });
    child.on("error", (e) => resolve({ content: null, error: `claude -p spawn error: ${e.message}` }));
  });
}
