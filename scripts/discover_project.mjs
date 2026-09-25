#!/usr/bin/env node
// M-FLOW.2 (PLAN-M-FLOW.md R2/R4) — PROJECT-LEVEL entry-point discovery.
// Contract, after the per-language discoverers have run:
//   stdin {files: {path: IR}, entryPoints: [...]} → stdout {entryPoints: [...extra]}
//
// A per-language discoverer sees one file at a time, so it cannot know
// that `ops-scripts/src/bash-scripts/company/infoApi/search.sh`
// is RUN — the evidence is in another file, in another language: a
// browser hook hands `"company/infoApi/search.sh"` to a Volt
// CommandStream; a shell orchestrator hands `"${DIR}/lib/rates.mjs"` to
// node. This step reads the whole map: every script a string literal
// names (scripts/frontends/script_refs.mjs — IR args, never source text)
// that no discoverer already made an entry becomes a `cli` entry with
// framework "command", seeded on `main` when the file defines and calls
// one at top level, else on the MODULE (the extractor's pseudo node for
// the statements that run when the file does). `metadata.invokedFrom`
// names the callers, so the entry says why it exists.
//
// NAMED LIMIT: a target KEY (`buildBackendCommand("company", …)`) is not a
// path; a table mapping keys to scripts is not read here (M-FLOW refusals).
import { nodeScriptRefs, resolveScriptFiles } from "./frontends/script_refs.mjs";

function topLevelMain(ir) {
  const nodes = ir.nodes ?? [];
  const mainFn = nodes.find((n) => n.type === "function_def" && n.name === "main" && n.parentId === null);
  if (!mainFn) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const atTop = (n) => {
    if (n.parentId === null || n.parentId === undefined) return true;
    const p = byId.get(n.parentId);
    return !!p && p.type !== "function_def" && p.type !== "class_def" && atTop(p);
  };
  const called = nodes.some((n) => ((n.type === "call" && n.funcName === "main") || (n.type === "assignment" && n.callTarget === "main")) && atTop(n));
  return called ? mainFn : null;
}

function executesAtTop(ir) {
  return (ir.nodes ?? []).some((n) => (n.parentId === null || n.parentId === undefined)
    && !["function_def", "class_def", "import", "import_from"].includes(n.type));
}

export function discoverProject(files, entryPoints) {
  const fileKeys = Object.keys(files);
  const haveEntry = new Set((entryPoints ?? []).map((e) => e.file));
  const invokedFrom = new Map(); // target file → [{file, nodeId, literal}]
  for (const [file, ir] of Object.entries(files)) {
    for (const n of ir.nodes ?? []) {
      // A module load is not a run (see crossings.ts).
      const callee = n.funcName ?? n.callTarget ?? "";
      if (typeof callee === "string" && /(^|\.)(import|require)$/.test(callee)) continue;
      for (const { literal, suffix } of nodeScriptRefs(n)) {
        const { files: matches } = resolveScriptFiles(fileKeys, suffix);
        // Only an EXACT naming counts as evidence of invocation; a suffix
        // several files share is recorded by the crossing as ambiguous and
        // makes no entry here (an entry is a claim the file is run).
        if (matches.length !== 1 || matches[0] === file) continue;
        const target = matches[0];
        if (!invokedFrom.has(target)) invokedFrom.set(target, []);
        const list = invokedFrom.get(target);
        if (list.length < 8) list.push({ file, nodeId: n.id, literal });
      }
    }
  }
  const out = [];
  for (const [target, callers] of [...invokedFrom.entries()].sort()) {
    if (haveEntry.has(target)) continue;
    const ir = files[target];
    if (!ir) continue;
    const main = topLevelMain(ir);
    if (!main && !executesAtTop(ir)) continue; // a library nothing runs
    const base = target.split("/").pop();
    const first = callers[0];
    out.push({
      id: `${target}:${main ? "main" : "module"}`,
      kind: "cli",
      file: target,
      irNodeId: main ? main.id : "module",
      qualifiedName: `${ir.modulePath ?? target}:${main ? "main" : "module"}`,
      label: base,
      summary: `run as a command: named by ${callers.length} call site${callers.length === 1 ? "" : "s"} (first: ${first.file} — \`${first.literal}\`)`,
      framework: "command",
      metadata: { seed: main ? "main" : "module", invokedFrom: callers },
    });
  }
  return out;
}

const isMain = process.argv[1] && /discover_project\.mjs$/.test(process.argv[1]);
if (isMain) {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) raw += chunk;
  const { files, entryPoints } = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ entryPoints: discoverProject(files ?? {}, entryPoints ?? []) }));
}
