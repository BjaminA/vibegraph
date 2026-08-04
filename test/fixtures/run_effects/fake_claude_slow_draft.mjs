#!/usr/bin/env node
/**
 * M-GF3.2 — SLOW stub `claude -p` for the drafting-motion e2e
 * (test/e2e/m-gf3-drafting-motion.spec.ts). Same deterministic replies as
 * fake_claude_system.mjs (architecture) / fake_claude_orchestrator.mjs
 * (roadmap), but after a real delay (VG_FAKE_DELAY_MS, default 2500) so
 * Playwright can OBSERVE the transient working states — the drafting ghost
 * card and the roadmap skeleton — before the proposal lands. Never the real
 * CLI in automation (M10R.7).
 */
const prompt = process.argv[process.argv.length - 1] ?? "";
const delay = Number(process.env.VG_FAKE_DELAY_MS ?? 2500);

function reply(text) {
  process.stdout.write(JSON.stringify({ result: text, is_error: false, session_id: "fake-slow-draft" }));
  process.exit(0);
}

setTimeout(() => {
  if (prompt.includes("planning the BUILD ORDER")) {
    reply(JSON.stringify({
      items: [
        { id: "note-validation", capability: "a pure validate_title module for notes", needs: [], groundedIn: "a flask API" },
        { id: "note-api", capability: "the flask POST /notes route over a sqlite store", needs: ["note-validation"], groundedIn: "a sqlite store" },
      ],
    }));
  } else {
    reply(JSON.stringify({
      subsystems: [
        { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
        { id: "db", kind: "db", label: "SQLite store", groundedIn: "a sqlite store" },
        { id: "cache", kind: "cache", label: "Redis cache", groundedIn: "a redis cache" },
      ],
      edges: [
        { from: "backend", to: "db", groundedIn: "a sqlite store" },
        { from: "backend", to: "cache", groundedIn: null },
      ],
    }));
  }
}, delay);
