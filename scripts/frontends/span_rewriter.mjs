// The span-splice edit floor as ONE core, for the C++ and Rust rewriters
// (2026-09-25). It is the pipeline rewrite_bash.mjs (M-LANG4) and
// rewrite_jsts.mjs (M-LANG5b) each carry — at a third and fourth consumer
// the repo's rule says extract it; bash and TS keep their own copies for
// now, and would move here unchanged. Same contracts as cst_rewrite.py
// (file-first argv, stdin source, --dry-run prints the raw new source, one
// JSON envelope, the closed errorKind taxonomy), same stages, never weakened
// (vibegraph-cst-ops):
//
//   resolve the structural id through the language's OWN builder (the parser
//   and the rewriter mint ids from one code path) → splice the byte span →
//   RE-PARSE (any ERROR/MISSING ⇒ parse_error, nothing written) → formatter
//   candidates, best first, each verified by the SHARED confinement check
//   (confinement.mjs, pinned to the same vectors as the other three) →
//   the raw splice, verified, {"formatted": false} when no formatter helps.
//
// A language supplies: build(source) → { builder: { nodes, spans } },
// hasErrors(source), formatCandidates(out, file, region) (an async iterable
// of { text, formatted }, WITHOUT the raw fallback — the core adds it), and
// its name for messages.

import { readFileSync, writeFileSync } from "node:fs";
import {
  OpError, verifyDiffConfined, simpleDiff,
  lineStartIndex, lineEndIndex, indentAt, reindent, dedent, fitToSpan,
} from "./confinement.mjs";

const SOURCE_CONSUMING = new Set([
  "replace_node", "insert_before", "insert_after",
  "replace_function_body", "replace_module_body",
]);
export const OPS = new Set([...SOURCE_CONSUMING, "delete_node"]);
const SELF_PIPELINE = new Set(["replace_function_body", "replace_module_body"]);

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
      return pre.slice(0, span.start) + fitToSpan(pre, span.start, newSource) + pre.slice(span.end);
    }
    case "replace_module_body":
      return newSource.endsWith("\n") ? newSource : newSource + "\n";
    default:
      throw new OpError("target_not_found", `unknown op ${op}`);
  }
}

/** The lines of `post` that differ from `pre` (1-indexed inclusive), anchored
 *  on the unchanged head and tail — what a span-scoped formatter may touch. */
export function changedRegion(pre, post) {
  const a = pre.split("\n"), b = post.split("\n");
  let h = 0;
  while (h < a.length && h < b.length && a[h] === b[h]) h++;
  let t = 0;
  while (t < a.length - h && t < b.length - h && a[a.length - 1 - t] === b[b.length - 1 - t]) t++;
  const first = Math.min(h + 1, b.length);
  return { first, last: Math.max(first, b.length - t) };
}

async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

/** Run one rewrite with a language's adapter; prints the JSON envelope. */
export async function runSpanRewriter(lang, argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const [file, op, nodeId] = positional;
  const dryRun = flags.has("--dry-run");
  const doFormat = !flags.has("--no-format");
  const allowSignatureChange = flags.has("--allow-signature-change");

  if (!file || !op || !OPS.has(op)) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: `usage: ${lang.script} <file> <op ∈ ${[...OPS].join("|")}> [node_id]`,
      errorKind: "target_not_found",
    }));
    return;
  }

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
    if (await lang.hasErrors(pre)) {
      throw new OpError("parse_error", `${file} does not parse cleanly before the edit`);
    }

    const { builder } = await lang.build(pre);
    let span = null;
    let irNode = null;
    let targetLines = null;
    if (op === "replace_module_body") {
      span = { start: 0, end: pre.length };
      targetLines = [1, pre.split("\n").length];
    } else {
      if (!nodeId) throw new OpError("target_not_found", `${op}: node_id required`);
      span = builder.spans.get(nodeId) ?? null;
      irNode = builder.nodes.find((n) => n.id === nodeId) ?? null;
      if (!span || !irNode) throw new OpError("target_not_found", `no node with id ${nodeId} in ${file}`);
      targetLines = [irNode.line, irNode.endLine];
      if (op === "replace_function_body" && irNode.type !== "function_def") {
        throw new OpError("wrong_node_kind", `replace_function_body target must be a function_def, got ${irNode.type}`);
      }
    }

    let newFnName = null;
    if (op === "replace_function_body") {
      const { builder: nb } = await lang.build(newSource);
      const fns = nb.nodes.filter((n) => n.type === "function_def" && n.parentId === null);
      if (fns.length !== 1) {
        throw new OpError("wrong_node_kind", `replace_function_body: new source must define exactly one function (got ${fns.length})`);
      }
      newFnName = fns[0].name;
    }

    const out = applyOp(pre, op, span, irNode, newSource, allowSignatureChange, newFnName);
    if (await lang.hasErrors(out)) throw new OpError("parse_error", `${op}: result does not parse — edit rejected`);

    const candidates = async function* () {
      if (doFormat) yield* lang.formatCandidates(out, file, changedRegion(pre, out));
      yield { text: out, formatted: false };
    };
    let written = null;
    let formatted = true;
    let lastErr = null;
    for await (const cand of candidates()) {
      try {
        if (await lang.hasErrors(cand.text)) throw new OpError("parse_error", "formatter broke the parse");
        if (!SELF_PIPELINE.has(op) || op === "replace_function_body") verifyDiffConfined(pre, cand.text, targetLines, op);
        written = cand.text;
        formatted = cand.formatted;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (written === null) {
      throw lastErr instanceof OpError ? lastErr : new OpError("diff_confinement_failed", String(lastErr?.message ?? lastErr));
    }
    if (dryRun) { process.stdout.write(written); return; }
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
