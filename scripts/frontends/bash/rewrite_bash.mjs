#!/usr/bin/env node
// M-LANG4 (PLAN-M-LANG.md) — the bash edit floor. Speaks
// scripts/cst_rewrite.py's exact CLI + result contracts so
// server.ts:spawnRewrite/_dryRunRewrite dispatch by language with no
// special cases:
//
//   node rewrite_bash.mjs <file> <op> [node_id] [--dry-run]
//        [--no-format] [--allow-signature-change]
//   source on stdin for source-consuming ops
//   wet:     writes the file, prints {"success": true, ...} JSON
//   dry-run: prints the proposed NEW SOURCE raw on stdout (cst_rewrite
//            parity — the preview path reads raw source, not JSON)
//   failure: prints {"success": false, "error", "errorKind", diff?}
//
// Op set v1 (PLAN-M-LANG M-LANG4): replace_node, insert_before,
// insert_after, delete_node, replace_function_body,
// replace_module_body. No capture_probe / intent placement — run stays
// gated for bash.
//
// Pipeline per op — the SAME shape as the Python chokepoint
// (vibegraph-cst-ops; never weakened):
//   parse → resolve structural id via the SHARED builder (builder.mjs —
//   the rewriter and parser mint IDs from one code path) → splice the
//   byte span → RE-PARSE (reject any ERROR/MISSING: parse_error) →
//   format candidates, best first, each of which must pass the
//   UNCHANGED confinement check before anything is written:
//     1. whole-file shfmt (when installed; shfmt has no --line-ranges,
//        so on a non-shfmt-clean file this correctly gets REJECTED by
//        confinement and the ladder falls through — span-scoped
//        formatting is the named future refinement, mirroring
//        pre-M-DIRTY black behaviour, and the check itself is never
//        skipped);
//     2. the raw splice, verified and reported {"formatted": false}
//        (the exact ladder Python uses when black is unavailable).
//
// The confinement check (verifyDiffConfined) replicates
// cst_rewrite.py:_verify_diff_confined line-for-line semantics
// (head/tail compare modulo rstrip, 1-indexed inclusive span) and is
// pinned against the SAME shared vectors
// (test/fixtures/rewrite_confinement/vectors.json) that
// test_cst_rewrite.py consumes — the two implementations cannot drift.
//
// errorKind taxonomy: the cst_rewrite closed set, no new members —
// parse_error, wrong_node_kind, diff_confinement_failed,
// target_not_found, empty_source.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildFromSource, sourceHasParseErrors } from "./builder.mjs";
// M-LANG5b — the confinement check moved to the shared module at its
// second Node consumer (rewrite_jsts.mjs); re-exported here so the
// bash suite's imports (and the shared-vector pinning) stay put.
import {
  OpError, verifyDiffConfined, simpleDiff,
  lineStartIndex, lineEndIndex, indentAt, reindent, dedent, fitToSpan,
} from "../confinement.mjs";

export { verifyDiffConfined, simpleDiff };

const SOURCE_CONSUMING = new Set([
  "replace_node", "insert_before", "insert_after",
  "replace_function_body", "replace_module_body",
]);
const OPS = new Set([...SOURCE_CONSUMING, "delete_node"]);
const SELF_PIPELINE = new Set(["replace_function_body", "replace_module_body"]);

// ── formatting ladder ─────────────────────────────────────────────────────

let shfmtChecked = null;
function shfmtAvailable() {
  if (shfmtChecked === null) {
    try {
      shfmtChecked = spawnSync("shfmt", ["--version"], { timeout: 5000 }).status === 0;
    } catch {
      shfmtChecked = false;
    }
  }
  return shfmtChecked;
}

function runShfmt(source) {
  const r = spawnSync("shfmt", [], { input: source, encoding: "utf-8", timeout: 10000 });
  if (r.status !== 0) throw new Error(`shfmt failed: ${r.stderr}`);
  return r.stdout;
}

function* formatCandidates(out, doFormat) {
  if (doFormat && shfmtAvailable()) {
    try {
      yield { text: runShfmt(out), formatted: true };
    } catch {
      /* fall through to raw */
    }
  }
  yield { text: out, formatted: false };
}

// ── op application (pure: pre source → post source) ──────────────────────

function applyOp(pre, op, span, node, newSource, allowSignatureChange, newFnName) {
  switch (op) {
    case "replace_node":
      return pre.slice(0, span.start) + fitToSpan(pre, span.start, newSource) + pre.slice(span.end);
    case "insert_before": {
      const at = lineStartIndex(pre, span.start);
      const indent = indentAt(pre, span.start);
      return pre.slice(0, at) + reindent(dedent(newSource), indent) + "\n" + pre.slice(at);
    }
    case "insert_after": {
      const at = lineEndIndex(pre, span.end === 0 ? 0 : span.end - 1);
      const indent = indentAt(pre, span.start);
      return pre.slice(0, at) + "\n" + reindent(dedent(newSource), indent) + pre.slice(at);
    }
    case "delete_node": {
      // Remove the byte span; if its line(s) end up whitespace-only,
      // remove the whole lines so no blank husk survives.
      const ls = lineStartIndex(pre, span.start);
      const le = lineEndIndex(pre, span.end === 0 ? 0 : span.end - 1);
      const before = pre.slice(ls, span.start);
      const after = pre.slice(span.end, le);
      if (!before.trim() && !after.trim()) {
        const cut = le < pre.length ? le + 1 : le; // swallow the newline
        return pre.slice(0, ls) + pre.slice(cut);
      }
      return pre.slice(0, span.start) + pre.slice(span.end);
    }
    case "replace_function_body": {
      // The panel sends the WHOLE function buffer (M18.3 contract).
      // Signature parity: the new text must define the same function
      // name unless --allow-signature-change (set only when the
      // selected node IS the function_def).
      if (!allowSignatureChange && newFnName !== null && newFnName !== node.name) {
        throw new OpError(
          "wrong_node_kind",
          `replace_function_body: new source defines '${newFnName}' but the target is '${node.name}' (signature changes need --allow-signature-change)`,
        );
      }
      return pre.slice(0, span.start) + fitToSpan(pre, span.start, newSource) + pre.slice(span.end);
    }
    case "replace_module_body":
      return newSource.endsWith("\n") ? newSource : newSource + "\n";
    default:
      throw new OpError("target_not_found", `unknown op ${op}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────

async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const [file, op, nodeId] = positional;
  const dryRun = flags.has("--dry-run");
  const doFormat = !flags.has("--no-format");
  const allowSignatureChange = flags.has("--allow-signature-change");

  if (!file || !op || !OPS.has(op)) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: `usage: rewrite_bash.mjs <file> <op ∈ ${[...OPS].join("|")}> [node_id]`,
      errorKind: "target_not_found",
    }));
    process.exit(0);
  }

  try {
    const pre = readFileSync(file, "utf-8");
    let newSource = "";
    if (SOURCE_CONSUMING.has(op)) {
      newSource = await readStdin();
      // M10R central guard: an empty payload on a source-consuming op
      // would be a SILENT DELETE that passes confinement. Deletion must
      // be explicit via delete_node.
      if (!newSource.trim()) {
        throw new OpError("empty_source", `${op}: empty source payload (use delete_node to delete)`);
      }
    }

    if (await sourceHasParseErrors(pre)) {
      throw new OpError("parse_error", `${file} does not parse cleanly before the edit`);
    }

    // Resolve the structural id through the SHARED builder.
    const { builder } = await buildFromSource(pre);
    let span = null;
    let irNode = null;
    let targetLines = null;
    const preLineCount = pre.split("\n").length;

    if (op === "replace_module_body") {
      span = { start: 0, end: pre.length };
      targetLines = [1, preLineCount];
    } else {
      if (!nodeId) throw new OpError("target_not_found", `${op}: node_id required`);
      span = builder.spans.get(nodeId) ?? null;
      irNode = builder.nodes.find((n) => n.id === nodeId) ?? null;
      if (!span || !irNode) {
        throw new OpError("target_not_found", `no node with id ${nodeId} in ${file}`);
      }
      targetLines = [irNode.line, irNode.endLine];
      if (op === "replace_function_body" && irNode.type !== "function_def") {
        throw new OpError("wrong_node_kind", `replace_function_body target must be a function_def, got ${irNode.type}`);
      }
    }

    // Signature parity needs the new text's function name.
    let newFnName = null;
    if (op === "replace_function_body") {
      const { builder: nb } = await buildFromSource(newSource);
      const fns = nb.nodes.filter((n) => n.type === "function_def" && n.parentId === null);
      if (fns.length !== 1) {
        throw new OpError("wrong_node_kind",
          `replace_function_body: new source must define exactly one function (got ${fns.length})`);
      }
      newFnName = fns[0].name;
    }

    const out = applyOp(pre, op, span, irNode, newSource, allowSignatureChange, newFnName);

    if (await sourceHasParseErrors(out)) {
      throw new OpError("parse_error", `${op}: result does not parse — edit rejected`);
    }

    // For inserts/replaces the confinement window is the TARGET's
    // pre-edit line span (grown content stays inside the anchored
    // head/tail, exactly like _verify_diff_confined). insert_before
    // adds lines AT line0 — still inside the window.
    let written = null;
    let formatted = true;
    let lastErr = null;
    for (const cand of formatCandidates(out, doFormat)) {
      try {
        if (await sourceHasParseErrors(cand.text)) throw new OpError("parse_error", "formatter broke the parse");
        if (!SELF_PIPELINE.has(op) || op === "replace_function_body") {
          verifyDiffConfined(pre, cand.text, targetLines, op);
        }
        written = cand.text;
        formatted = cand.formatted;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (written === null) {
      throw lastErr instanceof OpError
        ? lastErr
        : new OpError("diff_confinement_failed", String(lastErr?.message ?? lastErr));
    }

    if (dryRun) {
      process.stdout.write(written);
      return;
    }
    writeFileSync(file, written, "utf-8");
    const extra = {};
    if (SELF_PIPELINE.has(op)) {
      extra.diff = simpleDiff(pre.split("\n"), written.split("\n"));
      extra.newSource = written;
    }
    if (!formatted) extra.formatted = false;
    process.stdout.write(JSON.stringify({ success: true, ...extra }));
  } catch (e) {
    if (e instanceof OpError) {
      const payload = { success: false, error: `OpError: ${e.message}`, errorKind: e.kind };
      if (e.diff) payload.diff = e.diff;
      process.stdout.write(JSON.stringify(payload));
    } else {
      process.stdout.write(JSON.stringify({ success: false, error: `${e.constructor?.name}: ${e.message}` }));
    }
  }
}

// Import-guard: the confinement functions are imported by the test
// suite; main() runs only when invoked as the CLI.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
