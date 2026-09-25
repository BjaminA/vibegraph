#!/usr/bin/env node
// M-LANG5b (PLAN-M-LANG.md) — the JS/TS edit floor. Same contracts as
// cst_rewrite.py and rewrite_bash.mjs (file-first argv, stdin source,
// --dry-run prints raw new source, JSON envelope, the closed errorKind
// taxonomy), same pipeline shape (vibegraph-cst-ops, never weakened):
//
//   resolve structural id via the SHARED builder → splice the byte
//   span → RE-PARSE (ERROR ⇒ parse_error, nothing written) → format
//   candidates, best first, each verified by the SHARED confinement
//   check (scripts/frontends/confinement.mjs — pinned to the same
//   vectors as cst_rewrite.py and rewrite_bash.mjs):
//     1. SPAN-SCOPED prettier (rangeStart/rangeEnd — the M-DIRTY win
//        black has and shfmt lacks; the project's own .prettierrc is
//        respected via resolveConfig);
//     2. whole-file prettier (correctly REJECTED by confinement on a
//        non-prettier-clean file — the ladder falls through);
//     3. the raw splice, verified, {"formatted": false} — the
//        formatter-unavailable precedent.
//   prettier loads IN-PROCESS (devDependency); if the import fails the
//   ladder starts at candidate 3. ts-morph remains the NAMED FALLBACK
//   if span-splice ever proves lossy around decorators/JSX.
//
// Op set v1 (mirrors M-LANG4): replace_node, insert_before,
// insert_after, delete_node, replace_function_body (whole-function
// buffer + signature-parity guard), replace_module_body.

import { readFileSync, writeFileSync } from "node:fs";
import { buildFromSource, sourceHasParseErrors, dialectForPath } from "./builder.mjs";
import {
  OpError, verifyDiffConfined, simpleDiff,
  lineStartIndex, lineEndIndex, indentAt, reindent,
} from "../confinement.mjs";

export { verifyDiffConfined, simpleDiff };

const SOURCE_CONSUMING = new Set([
  "replace_node", "insert_before", "insert_after",
  "replace_function_body", "replace_module_body",
]);
const OPS = new Set([...SOURCE_CONSUMING, "delete_node"]);
const SELF_PIPELINE = new Set(["replace_function_body", "replace_module_body"]);

// ── formatting ladder (prettier in-process) ──────────────────────────────

let prettierMod = null;
let prettierTried = false;
async function getPrettier() {
  if (!prettierTried) {
    prettierTried = true;
    try {
      prettierMod = (await import("prettier")).default;
    } catch {
      prettierMod = null;
    }
  }
  return prettierMod;
}

async function* formatCandidates(out, file, span, doFormat) {
  const prettier = doFormat ? await getPrettier() : null;
  if (prettier) {
    const config = (await prettier.resolveConfig(file).catch(() => null)) ?? {};
    const opts = { ...config, parser: "typescript" };
    try {
      yield {
        text: await prettier.format(out, { ...opts, rangeStart: span.start, rangeEnd: span.end }),
        formatted: true,
      };
    } catch { /* fall through */ }
    try {
      yield { text: await prettier.format(out, opts), formatted: true };
    } catch { /* fall through */ }
  }
  yield { text: out, formatted: false };
}

// ── op application (pure: pre source → post source) ──────────────────────

function applyOp(pre, op, span, node, newSource, allowSignatureChange, newFnName) {
  switch (op) {
    case "replace_node":
      return pre.slice(0, span.start) + newSource.trimEnd() + pre.slice(span.end);
    case "insert_before": {
      const at = lineStartIndex(pre, span.start);
      const indent = indentAt(pre, span.start);
      return pre.slice(0, at) + reindent(newSource.trimEnd(), indent) + "\n" + pre.slice(at);
    }
    case "insert_after": {
      const at = lineEndIndex(pre, span.end === 0 ? 0 : span.end - 1);
      const indent = indentAt(pre, span.start);
      return pre.slice(0, at) + "\n" + reindent(newSource.trimEnd(), indent) + pre.slice(at);
    }
    case "delete_node": {
      const ls = lineStartIndex(pre, span.start);
      const le = lineEndIndex(pre, span.end === 0 ? 0 : span.end - 1);
      const before = pre.slice(ls, span.start);
      const after = pre.slice(span.end, le);
      if (!before.trim() && !after.trim()) {
        const cut = le < pre.length ? le + 1 : le;
        return pre.slice(0, ls) + pre.slice(cut);
      }
      return pre.slice(0, span.start) + pre.slice(span.end);
    }
    case "replace_function_body": {
      if (!allowSignatureChange && newFnName !== null && newFnName !== node.name) {
        throw new OpError(
          "wrong_node_kind",
          `replace_function_body: new source defines '${newFnName}' but the target is '${node.name}' (signature changes need --allow-signature-change)`,
        );
      }
      return pre.slice(0, span.start) + newSource.trimEnd() + pre.slice(span.end);
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
      error: `usage: rewrite_jsts.mjs <file> <op ∈ ${[...OPS].join("|")}> [node_id]`,
      errorKind: "target_not_found",
    }));
    process.exit(0);
  }

  // A .tsx file must be re-parsed with the JSX dialect, or the
  // confinement check would be proving its claim against a tree of
  // ERROR nodes rather than against the file.
  const dialect = dialectForPath(file);

  try {
    const pre = readFileSync(file, "utf-8");
    let newSource = "";
    if (SOURCE_CONSUMING.has(op)) {
      newSource = await readStdin();
      // M10R central guard: empty payload = silent delete → rejected.
      if (!newSource.trim()) {
        throw new OpError("empty_source", `${op}: empty source payload (use delete_node to delete)`);
      }
    }

    if (await sourceHasParseErrors(pre, dialect)) {
      throw new OpError("parse_error", `${file} does not parse cleanly before the edit`);
    }

    const { builder } = await buildFromSource(pre, undefined, dialect);
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

    let newFnName = null;
    if (op === "replace_function_body") {
      const { builder: nb } = await buildFromSource(newSource, undefined, dialect);
      const fns = nb.nodes.filter((n) => n.type === "function_def" && n.parentId === null);
      if (fns.length !== 1) {
        throw new OpError("wrong_node_kind",
          `replace_function_body: new source must define exactly one function (got ${fns.length})`);
      }
      newFnName = fns[0].name;
    }

    const out = applyOp(pre, op, span, irNode, newSource, allowSignatureChange, newFnName);

    if (await sourceHasParseErrors(out, dialect)) {
      throw new OpError("parse_error", `${op}: result does not parse — edit rejected`);
    }

    let written = null;
    let formatted = true;
    let lastErr = null;
    for await (const cand of formatCandidates(out, file, span, doFormat)) {
      try {
        if (await sourceHasParseErrors(cand.text, dialect)) throw new OpError("parse_error", "formatter broke the parse");
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
