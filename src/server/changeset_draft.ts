// PLAN-v7 Stage 4b — the BUILDER: LIVE changeset drafting for the build loop.
//
// 4a proved the gate→chokepoint→solidify loop with a canned changeset. 4b
// swaps that for a `claude -p` DRAFT: describe one capability ("the
// create-note flow") and the builder proposes the increment as a Changeset.
// Everything downstream is REUSED unchanged — the drafted changeset crosses
// the SAME validateChangeset boundary and the ENTIRE verification floor
// re-runs (dry create_file parses, sandbox, effect scan, behavioural check):
// a drafted increment gets no shortcut, and the human gate still owns accept.
//
// D1 lineage (bounded + escalating, not omniscient): the builder's context
// is DELIBERATELY BOUNDED to the ratified plan + the project's current file
// list + the one capability asked for. If the capability can't be built
// within the ratified plan, the honest move is to DECLINE (reply
// {"decline": "..."}), never to invent architecture the human didn't ratify.
//
// Mirrors compose_draft.ts / system_draft.ts: one-shot headless `claude -p`,
// VG_CLAUDE_BIN override for deterministic tests (M10R.7), honest decline on
// any failure.
//
// FENCE-FIRST protocol (the M18.5 lesson, re-learned live here): multi-line
// Python inside JSON strings is brittle — models emit literal newlines and
// the JSON breaks exactly on the big increments that matter. The builder
// replies in a line-oriented format with one ```python fence per module,
// parsed deterministically by parseBuilderReply (exported, unit-tested).

import { spawn } from "child_process";
// .ts extensions: run directly by node type-stripping in test:changeset-draft
// (same convention as compose_draft.ts; esbuild resolves them fine).
import { resolveClaudeBin } from "./run/synth_args.ts";
import { validateChangeset } from "./changeset.ts";
import type { Changeset, SystemPlan } from "../shared/protocol";
import type { ChatSession } from "./chat/backend.ts";

function buildPrompt(intent: string, plan: SystemPlan, existingFiles: string[],
                     existingSymbols?: Record<string, string[]>): string {
  const planLines = plan.subsystems
    .map((s) => `  - ${s.id} (${s.kind}): ${s.label}`)
    .join("\n");
  // 6c — edits need real targets: list each existing file with its
  // replaceable top-level structural node ids, so a REPLACE names a target
  // that actually exists (grounded, never guessed).
  const existingLines = existingFiles.length
    ? existingFiles.map((p) => {
        const syms = existingSymbols?.[p];
        return syms?.length ? `  ${p} (replaceable: ${syms.join(", ")})` : `  ${p}`;
      }).join("\n")
    : "  (none — the project is empty)";
  return [
    "You are a BUILDER agent for ONE increment of a Python project. Your context is",
    "DELIBERATELY BOUNDED to the ratified architecture plan below and the single",
    "capability asked for — do not invent subsystems or features beyond them.",
    "",
    "Reply in EXACTLY this line-oriented format (no other prose):",
    "LABEL: <short name for the increment>",
    "FILE: <project-relative path>",
    "```python",
    "<complete module source>",
    "```",
    "(repeat per stanza; three stanza kinds are available)",
    "  FILE: <path>                    — create a NEW module (full source in the fence)",
    "  APPEND: <path>                  — add code to the END of an EXISTING module",
    "  REPLACE: <path> @ <node-id>     — replace ONE existing top-level def/class",
    "                                    (fence holds the complete replacement)",
    "CHECK: <one sentence saying what passing proves>",
    "```python",
    "<a check module defining __vg_check__()>",
    "```",
    "",
    "Rules:",
    "- FILE paths must be NEW (project-relative, forward slashes, flat paths are",
    "  safest). APPEND/REPLACE paths must be EXISTING files from the list below;",
    "  a REPLACE node-id must be one of that file's replaceable ids verbatim.",
    "- every fence must be complete, syntactically valid Python.",
    "- NEVER emit the same path in two stanzas: ALL of a module's code —",
    "  every function and class it should contain — goes in ONE fence.",
    "- the CHECK module runs behind an effect-scan floor: __vg_check__() SHOULD only",
    "  call PURE functions (no file/db/network/subprocess I/O, no print) — an",
    "  effectful check stops at the gate until the human explicitly consents.",
    "  Design the increment so its core logic is testable purely when possible.",
    // Rehearsal-3: asked for "an 8->64->32->1 MLP with ReLU", the builder
    // invented a validated layer_plan() descriptor generator consumed by one
    // caller, for a network whose sizes are module-level constants. The
    // capability constrains behaviour, not construction, and the floors check
    // effects and behaviour — so nothing caught it, and the Arch view could no
    // longer enumerate a Sequential(*layers). This is the documented
    // counter-instruction for this model generation's scope expansion.
    "- build ONLY what the capability asks for. Do not add abstractions,",
    "  indirection, or configurability the capability did not request: no",
    "  descriptor/plan/registry layer for a fixed structure, no parameters that",
    "  only ever take their default, no helper with a single caller that would",
    "  read plainly inline. Prefer the direct construction — declare fixed",
    "  structures literally rather than generating them. Do not add validation",
    "  or error handling for inputs that cannot occur.",
    "- If the capability cannot be built within the ratified plan, reply with a",
    "  single line `DECLINE: <one-line reason>` instead — NEVER invent architecture.",
    "",
    "Existing files:",
    existingLines,
    "",
    "Ratified architecture plan (human-approved — build toward it):",
    planLines || "  (no subsystems ratified)",
    `Plan description: ${plan.description}`,
    "",
    `Capability to build now: ${intent}`,
  ].join("\n");
}

// Deterministic parser for the fence-first builder reply. Returns the raw
// pieces (validation happens at the Changeset boundary) or an error.
// 6c stanzas: FILE (create), APPEND (append_end), REPLACE path @ node-id
// (replace_node) — parsed with ONE combined regex so reply order is kept.
export function parseBuilderReply(text: string):
  | { decline: string }
  | { label: string; files: Array<{ path: string; content: string; op?: "create_file" | "append_end" | "replace_node"; nodeId?: string }>; check: { module: string; description: string } }
  | { error: string } {
  const t = text.trim();
  const decline = t.match(/^DECLINE:\s*(.+)$/m);
  if (decline) return { decline: decline[1].trim() };

  const label = t.match(/^LABEL:\s*(.+)$/m)?.[1]?.trim();
  if (!label) return { error: "builder reply has no LABEL: line" };

  // Each stanza header captures the ```python fence that follows it.
  const files: Array<{ path: string; content: string; op?: "create_file" | "append_end" | "replace_node"; nodeId?: string }> = [];
  const stanzaRe = /^(FILE|APPEND|REPLACE):\s*(.+?)\s*\n+```(?:python)?\s*\n([\s\S]*?)\n```/gm;
  for (const m of t.matchAll(stanzaRe)) {
    const kind = m[1];
    const header = m[2].trim();
    const content = m[3].replace(/\s*$/, "") + "\n";
    if (kind === "FILE") {
      files.push({ path: header, content });
    } else if (kind === "APPEND") {
      files.push({ path: header, content, op: "append_end" });
    } else {
      const at = header.split("@");
      if (at.length !== 2) return { error: `REPLACE header must be "<path> @ <node-id>" (got: ${header})` };
      files.push({ path: at[0].trim(), content, op: "replace_node", nodeId: at[1].trim() });
    }
  }
  if (files.length === 0) return { error: "builder reply has no FILE:/APPEND:/REPLACE: blocks" };

  // Duplicate-path stanzas: models sometimes split one module across two
  // fences (live failure: two `data.py` stanzas → the changeset boundary's
  // duplicate-path refusal killed the whole stage). When the ops compose —
  // create+create, create+append, append+append — fold the later fence into
  // the earlier stanza (two blank lines between chunks, PEP 8 top-level
  // spacing). replace_node never merges (two bodies for one node id is a
  // real conflict) and append-then-create is contradictory — both are left
  // for validateChangeset to refuse honestly.
  const byPath = new Map<string, (typeof files)[number]>();
  const merged: typeof files = [];
  for (const f of files) {
    const prior = byPath.get(f.path);
    const priorOp = prior?.op ?? "create_file";
    const op = f.op ?? "create_file";
    const foldable = prior !== undefined
      && priorOp !== "replace_node" && op !== "replace_node"
      && !(priorOp === "append_end" && op === "create_file");
    if (prior && foldable) {
      prior.content = prior.content.replace(/\n+$/, "") + "\n\n\n" + f.content;
      continue;
    }
    if (!prior) byPath.set(f.path, f);
    merged.push(f);
  }
  files.length = 0;
  files.push(...merged);

  const checkM = t.match(/^CHECK:\s*(.+?)\s*\n+```(?:python)?\s*\n([\s\S]*?)\n```/m);
  if (!checkM) return { error: "builder reply has no CHECK: block" };

  return {
    label,
    files,
    check: { description: checkM[1].trim(), module: checkM[2].replace(/\s*$/, "") + "\n" },
  };
}

export interface ChangesetDraftResult {
  changeset: Changeset | null; // boundary-validated draft, or null on decline
  error?: string;               // diagnostic / the model's honest decline
}

/** Shared tail of both transports: builder reply text → validated draft. */
function processBuilderText(text: string): ChangesetDraftResult {
  const parsed = parseBuilderReply(text);
  if ("error" in parsed) {
    return { changeset: null, error: `${parsed.error}: ${text.slice(0, 200)}` };
  }
  // The builder's honest escalation: decline rather than invent.
  if ("decline" in parsed) {
    return { changeset: null, error: `builder declined: ${parsed.decline}` };
  }
  const changeset: Changeset = {
    label: parsed.label,
    files: parsed.files,
    check: parsed.check,
    drafted: true,
  };
  // SAME boundary as 4a's canned path — a drafted changeset gets no
  // shortcut (and the full floor re-runs downstream in propose).
  const invalid = validateChangeset(changeset);
  if (invalid) {
    return { changeset: null, error: `drafted changeset failed validation: ${invalid}` };
  }
  return { changeset };
}

// Draft one build increment. Resolves { changeset } on success or
// { changeset: null, error } on any failure — never throws.
//
// OPUS-SHOWDOWN follow-up (2026-08-02): when `session` is provided
// (VG_BUILD_SESSION=1), the increment is a TURN in one persistent
// stream-json claude child instead of a fresh `claude -p` spawn — the
// per-spawn context re-establishment (~20-33k cache-write tokens per
// increment, the dominant cost in the metered comparison) collapses to
// once per run, and a modify redraft happens in a session that REMEMBERS
// the draft it is fixing. The prompt is IDENTICAL in both transports
// (full current state per turn — file lists change between increments, so
// freshness is re-sent, never assumed from session memory) and the reply
// crosses the same parse → validate boundary.
export function draftChangeset(
  intent: string,
  plan: SystemPlan,
  existingFiles: string[],
  cwd: string,
  existingSymbols?: Record<string, string[]>, // 6c — path → replaceable top-level node ids
  session?: ChatSession, // VG_BUILD_SESSION transport (see above)
): Promise<ChangesetDraftResult> {
  const prompt = buildPrompt(intent, plan, existingFiles, existingSymbols);
  if (session) {
    return (async () => {
      try {
        let text = "";
        let errMsg: string | null = null;
        for await (const ev of session.sendTurn(prompt)) {
          if (ev.type === "token") text += ev.delta;
          else if (ev.type === "error") errMsg = ev.message;
        }
        if (errMsg) return { changeset: null, error: `builder session error: ${errMsg}` };
        return processBuilderText(text);
      } catch (e) {
        return { changeset: null, error: `builder session failed: ${(e as Error).message}` };
      }
    })();
  }
  // Model tier: thinking — the builder writes real code.
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
        resolve({ changeset: null, error: `claude -p exited ${code}: ${first}` });
        return;
      }
      let text = "";
      try {
        const parsed = JSON.parse(out);
        text = typeof parsed.result === "string" ? parsed.result : "";
      } catch {
        resolve({ changeset: null, error: `could not parse claude -p envelope: ${out.slice(0, 200)}` });
        return;
      }
      resolve(processBuilderText(text));
    });
    child.on("error", (e) => {
      resolve({ changeset: null, error: `claude -p spawn error: ${e.message}` });
    });
  });
}
