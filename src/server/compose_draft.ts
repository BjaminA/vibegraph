// PLAN-v7 Stage 1b — LIVE proposal generation for the preview-before-write loop.
//
// Stage 1a proved the loop with a CANNED insert spec. 1b swaps that canned
// source for a `claude -p` DRAFT: describe the function you want ("add a retry
// wrapper around the http call") and the model returns the complete function
// source. Everything downstream is REUSED unchanged — the draft is handed to
// composeProposeCore, which dry-runs the SAME op the wet write would run, so
// the ghost the user ratifies is byte-for-byte what accept writes (G1). No
// disk write ever bypasses the CST chokepoint.
//
// Mirrors synth_args.ts exactly: one-shot headless `claude -p --output-format
// json`, VG_CLAUDE_BIN override for deterministic tests (never the real CLI in
// automation — M10R.7), analyzed-project cwd, honest decline on any failure.
//
// HONESTY: the draft is Claude's PROPOSAL, not a fact. It becomes honest IR
// only once accepted, written, and re-parsed (X5). The ghost carries a
// `drafted` flag so the badge reads "CLAUDE DRAFT — not yet written".

import { spawn } from "child_process";
// .ts extensions: this leaf module is run directly by node's type-stripping in
// test:compose-draft, which requires explicit extensions on relative imports.
// esbuild (the server bundle) resolves them fine; tsc's TS5097 on these is the
// same pre-existing noise as the other node-run backends.
import { resolveClaudeBin } from "./run/synth_args.ts";
import { extractFunctionSource } from "./intent_extract.ts";

function buildPrompt(intent: string, anchorLabel: string | null): string {
  return [
    "You are drafting ONE new Python function to be INSERTED into an existing module.",
    "Return ONLY the complete function inside a single ```python code block.",
    "No explanation before or after the block.",
    "- Emit a single top-level `def` (or `async def`); no imports, no surrounding code.",
    "- Give it a clear, descriptive name and a signature that fits the described purpose.",
    "- Keep it self-contained and syntactically valid on its own.",
    "",
    `Intent: ${intent}`,
    anchorLabel ? `It will be inserted just after: ${anchorLabel}` : "It will be appended to the end of the module.",
  ].join("\n");
}

export interface DraftResult {
  source: string | null; // the extracted function source, or null on decline
  error?: string;         // diagnostic when source is null
}

// Draft a function for `intent`. Resolves { source } on success, or
// { source: null, error } on any failure (never throws — the caller surfaces
// the honest decline). `cwd` is the analyzed project root.
export function draftInsertion(intent: string, anchorLabel: string | null, cwd: string): Promise<DraftResult> {
  const prompt = buildPrompt(intent, anchorLabel);
  // Model tier: thinking — drafts code that lands on disk.
  const { cmd, args: pre } = resolveClaudeBin("thinking");
  return new Promise((resolve) => {
    const child = spawn(
      cmd,
      [...pre, "-p", "--output-format", "json", "--strict-mcp-config",
        "--mcp-config", '{"mcpServers":{}}',
        "--dangerously-skip-permissions", "--", prompt],
      { cwd, env: { ...process.env } },
    );
    child.stdin?.end(); // 6d pre-flight: no open pipe — claude -p otherwise waits 3s for stdin per draft
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
    child.stderr.on("data", (b: Buffer) => { err += b.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        const first = err.split("\n").find((l) => l.trim()) ?? `exit ${code}`;
        resolve({ source: null, error: `claude -p exited ${code}: ${first}` });
        return;
      }
      // claude -p --output-format json wraps the model's reply text in `.result`.
      let text = "";
      try {
        const parsed = JSON.parse(out);
        text = typeof parsed.result === "string" ? parsed.result : "";
      } catch {
        resolve({ source: null, error: `could not parse claude -p envelope: ${out.slice(0, 200)}` });
        return;
      }
      const fn = extractFunctionSource(text);
      if (!fn) {
        resolve({ source: null, error: `no function extracted from draft: ${text.slice(0, 200)}` });
        return;
      }
      resolve({ source: fn });
    });
    child.on("error", (e) => {
      resolve({ source: null, error: `claude -p spawn error: ${e.message}` });
    });
  });
}
