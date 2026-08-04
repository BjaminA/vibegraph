#!/usr/bin/env node
/**
 * PLAN-v7 Stage 3b — stub `claude -p --output-format json` for the
 * architecture-draft loop (test/e2e/plan-v7-3b-greenfield.spec.ts). Emits a
 * fixed architecture as the model reply inside the real CLI's `.result`
 * envelope, deterministically (never the real `claude` in automation).
 *
 * The cache subsystem deliberately claims a FABRICATED quote ("a memcached
 * cluster" — not in the e2e's description): enforceGrounding must demote it
 * to null/INFERRED, and the e2e asserts the ⚠ INFERRED chip renders. The
 * honesty floor is exercised end-to-end, not just unit-tested.
 */
const arch = {
  subsystems: [
    { id: "backend", kind: "backend", label: "Flask API", groundedIn: "a flask API" },
    { id: "db", kind: "db", label: "SQLite store", groundedIn: "a sqlite store" },
    { id: "cache", kind: "cache", label: "Redis cache", groundedIn: "a memcached cluster" },
  ],
  edges: [
    { from: "backend", to: "db", groundedIn: "a sqlite store" },
    { from: "backend", to: "cache", groundedIn: null },
  ],
};
process.stdout.write(JSON.stringify({ result: JSON.stringify(arch), is_error: false, session_id: "fake-system" }));
process.exit(0);
