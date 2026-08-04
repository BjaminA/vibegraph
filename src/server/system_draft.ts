// PLAN-v7 Stage 3b — LIVE architecture drafting for the system-plan loop.
//
// 3a proved the ghost→ratify loop with a canned plan. 3b swaps that for a
// `claude -p` DRAFT: describe the project ("a flask API with a sqlite store")
// and the model proposes the minimal architecture as a SystemPlan. Everything
// downstream is REUSED unchanged — the draft goes through the SAME
// validateSystemPlan boundary and the same ghost/ratify gate.
//
// Mirrors compose_draft.ts: one-shot headless `claude -p --output-format
// json`, VG_CLAUDE_BIN override for deterministic tests (never the real CLI
// in automation — M10R.7), honest decline on any failure.
//
// HONESTY — two layers:
// 1. The prompt demands per-item `groundedIn` as a VERBATIM quote from the
//    description, or null when the item is inferred (proposed unasked).
// 2. enforceGrounding() then CHECKS every claimed quote against the actual
//    description — a "quote" that doesn't appear in the user's words is not
//    grounding, so it is demoted to null/INFERRED (the A3 citation-validation
//    lineage: never let the model manufacture its own evidence).

import { spawn } from "child_process";
// .ts extensions: run directly by node type-stripping in test:system-draft
// (same convention as compose_draft.ts; esbuild resolves them fine).
import { resolveClaudeBin } from "./run/synth_args.ts";
import { validateSystemPlan } from "./system_plan.ts";
import type { SystemPlan } from "../shared/protocol";

function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}

export function buildPrompt(description: string): string {
  return [
    "You are proposing a SOFTWARE ARCHITECTURE PLAN from a user's project description.",
    'Return ONLY a JSON object of the form {"subsystems": [...], "edges": [...]} — no prose, no code fence.',
    "",
    'Each subsystem: {"id": string, "kind": string, "label": string, "groundedIn": string|null}',
    "- kind MUST be one of: frontend | backend | db | cache | external_http | library.",
    "- KIND SEMANTICS — a planned subsystem only SOLIDIFIES when parsed code matches its",
    "  kind, so a mis-kinded item becomes a permanent unfulfilled ghost (M-GF finding:",
    "  a CNN trainer drafted as `backend`, a CLI as `frontend`, a csv file as `db` —",
    "  none can ever solidify):",
    "  - backend = a WEB backend: HTTP route handlers (flask/fastapi/django routes).",
    "    A CLI tool, training pipeline, or plain-Python program is NOT a backend.",
    "  - frontend = a browser client (a web/ dir with JS/components). A command-line",
    "    interface is NOT a frontend.",
    "  - db = a real DATABASE the code calls (sqlite/postgres/redis…). Data FILES the",
    "    code reads (csv/json/parquet) are NOT a db — they live inside the code that",
    "    loads them.",
    "  - library = the project's own non-web Python: models, pipelines, CLI tools,",
    "    helpers. A pure-ML or CLI project is usually ONE library subsystem (plus db",
    "    only if it uses a real database).",
    '- id is the bare kind (e.g. "backend", "db"), EXCEPT external_http whose id is "external_http:<host>".',
    "  At most one subsystem per bare kind.",
    '- label is a short human name (e.g. "Flask API", "SQLite store").',
    "",
    'Each edge: {"from": string, "to": string, "groundedIn": string|null} — subsystem ids,',
    "direction = caller/writer -> callee/store.",
    "",
    "GROUNDING RULES (strict):",
    "- groundedIn MUST be a SHORT VERBATIM QUOTE from the description that justifies the item.",
    "- If an item is not justified by the description but you believe it is implied, set",
    "  groundedIn to null — null marks it INFERRED and the user will see that label.",
    "- NEVER fabricate or paraphrase a quote. Quotes are checked against the description.",
    "- Propose the MINIMAL architecture the description implies. Do not embellish.",
    "",
    "Description:",
    description,
  ].join("\n");
}

// Demote any groundedIn "quote" that does not actually appear in the
// description (case-insensitive substring) to null/INFERRED. Returns the
// number of demotions so callers can log the honesty correction.
export function enforceGrounding(plan: SystemPlan, description: string): number {
  const hay = description.toLowerCase();
  let demoted = 0;
  const check = (g: string | null): string | null => {
    if (g == null) return null;
    if (hay.includes(g.toLowerCase())) return g;
    demoted += 1;
    return null;
  };
  for (const s of plan.subsystems) s.groundedIn = check(s.groundedIn);
  for (const e of plan.edges) e.groundedIn = check(e.groundedIn);
  return demoted;
}

export interface SystemDraftResult {
  plan: SystemPlan | null; // validated, grounding-enforced plan, or null on decline
  error?: string;           // diagnostic when plan is null
}

// Draft an architecture plan for `description`. Resolves { plan } on success
// or { plan: null, error } on any failure — never throws.
export function draftSystemPlan(description: string, cwd: string): Promise<SystemDraftResult> {
  const prompt = buildPrompt(description);
  // Model tier: thinking — architecture design.
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
        resolve({ plan: null, error: `claude -p exited ${code}: ${first}` });
        return;
      }
      let text = "";
      try {
        const parsed = JSON.parse(out);
        text = typeof parsed.result === "string" ? parsed.result : "";
      } catch {
        resolve({ plan: null, error: `could not parse claude -p envelope: ${out.slice(0, 200)}` });
        return;
      }
      let body: any;
      try {
        body = JSON.parse(stripFence(text));
      } catch {
        resolve({ plan: null, error: `model reply was not JSON: ${text.slice(0, 200)}` });
        return;
      }
      const plan: SystemPlan = {
        version: "1",
        description,
        subsystems: Array.isArray(body?.subsystems) ? body.subsystems : [],
        edges: Array.isArray(body?.edges) ? body.edges : [],
        drafted: true,
      };
      // SAME boundary as 3a's canned path — a drafted plan gets no shortcut.
      const invalid = validateSystemPlan(plan);
      if (invalid) {
        resolve({ plan: null, error: `drafted plan failed validation: ${invalid}` });
        return;
      }
      if (plan.subsystems.length === 0) {
        resolve({ plan: null, error: "drafted plan proposed no subsystems" });
        return;
      }
      const demoted = enforceGrounding(plan, description);
      if (demoted > 0) {
        console.warn(`  [SystemDraft] demoted ${demoted} fabricated quote(s) to INFERRED`);
      }
      resolve({ plan });
    });
    child.on("error", (e) => {
      resolve({ plan: null, error: `claude -p spawn error: ${e.message}` });
    });
  });
}
