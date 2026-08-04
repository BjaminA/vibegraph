// PLAN-v7 Stage 5b — LIVE roadmap drafting for the orchestrator.
//
// Decompose the RATIFIED architecture plan into an ordered, dependency-aware
// capability list. JSON reply is safe here (short prose strings, no code —
// the fence-first rule applies to code payloads, which this never carries).
// The draft crosses the SAME validateBuildPlan boundary as the canned path
// (foundation-first is STRUCTURAL there: needs[] may only reference earlier
// items), and grounding is enforced the same way as the system draft —
// claimed quotes not present in the description are demoted to INFERRED.
//
// Mirrors system_draft.ts; VG_CLAUDE_BIN stub for tests (M10R.7).

import { spawn } from "child_process";
// .ts extensions: run directly by node type-stripping in test:build-plan-draft.
import { resolveClaudeBin } from "./run/synth_args.ts";
import { validateBuildPlan } from "./build_plan.ts";
import type { BuildPlan, SystemPlan } from "../shared/protocol";

function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}

// M-GF3.5 — a Modify on the proposed roadmap: the human's guidance plus the
// draft it applies to. The drafter REVISES (same JSON contract, full list
// back) instead of restarting blind.
export interface RoadmapRevision {
  guidance: string;
  previous?: BuildPlan | null;
}

function buildPrompt(plan: SystemPlan, revision?: RoadmapRevision): string {
  const planLines = plan.subsystems.map((s) => `  - ${s.id} (${s.kind}): ${s.label}`).join("\n");
  const revisionLines = revision
    ? [
        "",
        "A previous draft exists and the human asked for a REVISION. Keep what the",
        "guidance doesn't touch; return the FULL revised roadmap (same JSON contract,",
        "same ordering rules).",
        ...(revision.previous
          ? [
              "Previous draft:",
              ...revision.previous.items.map(
                (i) => `  ${i.id}: ${i.capability}${i.needs.length ? ` (needs: ${i.needs.join(", ")})` : ""}`,
              ),
            ]
          : []),
        `REVISION GUIDANCE: ${revision.guidance}`,
      ]
    : [];
  return [
    "You are planning the BUILD ORDER for a Python project whose architecture a human",
    "has already ratified. Decompose it into 2-7 SMALL, sequential capabilities — each",
    "one buildable as a single increment of a few new modules.",
    "",
    'Return ONLY a JSON object: {"items": [{"id", "capability", "needs", "groundedIn"}]}',
    "- id: a short kebab-case slug (e.g. \"note-validation\").",
    "- capability: ONE sentence instructing a builder what to build (it will be handed",
    "  to a builder agent verbatim). Concrete, not vague.",
    "- needs: ids of items that must be BUILT FIRST. An item may only need items that",
    "  appear EARLIER in the list — the list order IS the build order.",
    "- groundedIn: a SHORT VERBATIM QUOTE from the plan description justifying the item,",
    "  or null if inferred. NEVER fabricate a quote (quotes are checked).",
    "",
    "FOUNDATION-FIRST ordering (strict): pure logic first, then storage, then routes/",
    "wiring — each increment must be verifiable the moment it lands, and every",
    "increment's behavioural check can only exercise PURE functions, so front-load the",
    "pure cores the later increments will lean on.",
    "",
    "Ratified architecture:",
    planLines || "  (none)",
    `Description: ${plan.description}`,
    ...revisionLines,
  ].join("\n");
}

export interface BuildPlanDraftResult {
  plan: BuildPlan | null;
  error?: string;
}

export function draftBuildPlan(sysPlan: SystemPlan, cwd: string, revision?: RoadmapRevision): Promise<BuildPlanDraftResult> {
  const prompt = buildPrompt(sysPlan, revision);
  // Model tier: thinking — roadmap planning.
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
        resolve({ plan: null, error: `roadmap reply was not JSON: ${text.slice(0, 200)}` });
        return;
      }
      const items = Array.isArray(body?.items) ? body.items : [];
      const plan: BuildPlan = {
        version: "1",
        description: sysPlan.description,
        items: items.map((it: any) => ({
          id: it?.id,
          capability: it?.capability,
          needs: Array.isArray(it?.needs) ? it.needs : [],
          groundedIn: it?.groundedIn ?? null,
          status: "pending",
        })),
        drafted: true,
      };
      const invalid = validateBuildPlan(plan);
      if (invalid) {
        resolve({ plan: null, error: `drafted roadmap failed validation: ${invalid}` });
        return;
      }
      // Grounding enforcement (the system-draft lineage): a "quote" not in
      // the description is not grounding — demote to INFERRED.
      const hay = sysPlan.description.toLowerCase();
      let demoted = 0;
      for (const it of plan.items) {
        if (it.groundedIn != null && !hay.includes(it.groundedIn.toLowerCase())) {
          it.groundedIn = null;
          demoted += 1;
        }
      }
      if (demoted > 0) console.warn(`  [BuildPlanDraft] demoted ${demoted} fabricated quote(s) to INFERRED`);
      resolve({ plan });
    });
    child.on("error", (e) => {
      resolve({ plan: null, error: `claude -p spawn error: ${e.message}` });
    });
  });
}
