// Shared setup for test/brief_checks.test.mjs: a copy of
// test/fixtures/system/views_demo with what the Brief review's checks need —
// two rules a person stated (one guarding a function, one with no check), a
// probe script that writes status the way a live check does, and two docs:
// the project's own handover and a tool's feedback log (left out by default).
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function briefChecksProject() {
  const tmp = mkdtempSync(join(tmpdir(), "vg-brief-checks-"));
  const proj = join(tmp, "p");
  cpSync(join(ROOT, "test/fixtures/system/views_demo"), proj, { recursive: true });
  writeFileSync(join(proj, ".vibegraph/constraints.json"), JSON.stringify({ version: "1", constraints: [
    { id: "c1", kind: "invariant", text: "Only the decider applies a transition to an order's status.", scope: { all: true },
      check: { rule: "callers-only", target: "applyTransition", files: ["decider/bin/decider.ts"] }, source: "human", createdAt: "2026-10-08T00:00:00.000Z" },
    { id: "c2", kind: "invariant", text: "Every order request is kept until the order is released.", scope: { all: true }, source: "human", createdAt: "2026-10-08T00:00:00.000Z" },
  ] }));
  mkdirSync(join(proj, "tools"), { recursive: true });
  writeFileSync(join(proj, "tools/probe-status.ts"), [
    "#!/usr/bin/env node",
    "// a live probe: writes status the way only the decider should, to see it refused",
    'import { writeDoc } from "../lib/store";',
    'await writeDoc("status", "o1", { phase: "released" });',
    "",
  ].join("\n"));
  mkdirSync(join(proj, "docs"), { recursive: true });
  writeFileSync(join(proj, "docs/HANDOVER.md"), [
    "# Handover", "",
    "The decider applies each transition (applyTransition) and is the only writer of status, per c1.",
    "Clerks file requests in the app; the gateway forwards partner requests to the decider.",
    "",
  ].join("\n"));
  writeFileSync(join(proj, "docs/vibegraph-feedback.md"), [
    "# Tool feedback", "",
    "The decider box and the gateway box and the app box were drawn with applyTransition and c1 and c2 labels.",
    "",
  ].join("\n"));
  return { tmp, proj };
}
