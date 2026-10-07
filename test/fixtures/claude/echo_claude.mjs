#!/usr/bin/env node
// A stand-in for `claude -p --output-format json`: answers with the argv it was
// given, so a test can see exactly what reached Claude (test/find_claude.test.mjs).
if (process.argv.includes("--version")) { process.stdout.write("9.9.9 (Claude Code)\n"); process.exit(0); }
process.stdout.write(JSON.stringify({ result: JSON.stringify(process.argv.slice(2)), model: "echo" }));
