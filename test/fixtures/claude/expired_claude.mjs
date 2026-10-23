#!/usr/bin/env node
// A stand-in for `claude -p --output-format json` whose login has expired: it
// answers the way the real CLI does, `is_error` with the message, exit 1
// (test/model_failure.test.mjs).
if (process.argv.includes("--version")) { process.stdout.write("9.9.9 (Claude Code)\n"); process.exit(0); }
process.stdout.write(JSON.stringify({ type: "result", is_error: true, result: "Failed to authenticate. API Error: 401 OAuth session expired and could not be refreshed" }));
process.exit(1);
