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
import { packageRunFiles } from "./package_entries.mjs";

/** Mirrors isTestFile in src/shared/path_match.ts: this script is also run as
 *  a plain `node` child of the server, which cannot import .ts on Node 20. */
function isTestFile(path) {
  const segs = path.split("/");
  const base = segs[segs.length - 1] ?? "";
  return segs.slice(0, -1).some((s) => s === "test" || s === "tests" || s === "__tests__")
    || /^test_/.test(base) || /\.(test|spec)\.[A-Za-z]+$/.test(base) || /_test\.[A-Za-z]+$/.test(base);
}

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

// 2026-09-30 — naming a file is not running it. A SHELL script named in a
// string is how a shell script is run (`CommandStream("accounts/x.sh")`), so
// that stays evidence. A SOURCE file (.ts/.js/.py/…) named in a string is far
// more often READ — `readFileSync(".../decision-tree.ts")`, a test's
// `vi.mock` path, a docs build — and a real project had its data module (a
// decision tree) reported as a command-run thread of one node. A source file
// is RUN only when it says it is (a `#!` line) or the naming is an execution:
// a process-spawning call, or an interpreter word beside the path.
const SHELL_TARGET = /\.(sh|bash)$|(^|\/)[^./]+$/;
const RUN_CALLEE = /(^|\.)(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|execa|execaSync|execaNode|system|popen|Popen|run|call|check_call|check_output|runScript)$/;
const INTERPRETER = /(^|[\s"'`[(,])(node|nodejs|tsx|ts-node|deno|bun|python3?|pypy3?|ruby|perl|cargo)(?=[\s"'`,)\]]|$)/;
function executes(n) {
  const callee = n.funcName ?? n.callTarget ?? "";
  if (typeof callee === "string" && RUN_CALLEE.test(callee)) return true;
  // A shell `node "$DIR/x.mjs"` is a call whose CALLEE is the interpreter.
  const text = [callee, ...(n.args ?? []), n.preview ?? "", ...(n.literals ?? [])].join(" ");
  return INTERPRETER.test(text);
}

function executesAtTop(ir) {
  return (ir.nodes ?? []).some((n) => (n.parentId === null || n.parentId === undefined)
    && !["function_def", "class_def", "import", "import_from"].includes(n.type));
}

export function discoverProject(files, entryPoints, manifests = []) {
  const fileKeys = Object.keys(files);
  // a thin script whose `__main__` runs an imported main is seeded at that
  // main (discover_entry_points.py), and `runBy` names the script: it has one
  const haveEntry = new Set((entryPoints ?? []).flatMap((e) => [e.file, ...(e.metadata?.runBy ?? [])]));
  // 2026-10-01 — what a package.json runs (scripts/package_entries.mjs): a
  // `bin`, or a script whose runner names the file. The package's own words
  // are the evidence, so it needs no literal elsewhere and no top-level code.
  const pkgOut = [];
  for (const r of packageRunFiles(manifests, fileKeys)) {
    if (haveEntry.has(r.file) || pkgOut.some((e) => e.file === r.file)) continue;
    const ir = files[r.file];
    const main = topLevelMain(ir);
    if (!main && !executesAtTop(ir)) continue; // a bin that only exports has nothing that runs
    pkgOut.push({
      id: `${r.file}:${main ? "main" : "module"}`, kind: "cli", file: r.file, irNodeId: main ? main.id : "module",
      qualifiedName: `${ir.modulePath ?? r.file}:${main ? "main" : "module"}`, label: r.file.split("/").pop(),
      summary: `run by the package: ${r.how}`, framework: r.bin ? "package-bin" : "package-script",
      metadata: { seed: main ? "main" : "module", package: r.pkg, ...(r.bin ? { bin: r.bin } : { script: r.script }) },
    });
  }
  for (const e of pkgOut) haveEntry.add(e.file);
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
        // A shell script's job is running programs: `MJS="${DIR}/ingest.mjs"`
        // then `"$NODE" "$MJS"` names the file in one node and runs it in
        // another, so inside a shell file the naming is the evidence.
        if (!SHELL_TARGET.test(target) && !files[target]?.shebang && ir.language !== "bash" && !executes(n)) continue;
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
  // 2026-10-01 — last, the weakest evidence: a JS/TS file that, when loaded,
  // awaits at the top, calls `.listen(…)` or reads `process.argv` (the
  // builder's `programSignals`) is a PROGRAM. After the package and the
  // command rules, so a file another file runs keeps who runs it.
  for (const e of out) haveEntry.add(e.file);
  const progOut = [];
  for (const [file, ir] of Object.entries(files)) {
    const signals = ir?.programSignals ?? [];
    if (!signals.length || haveEntry.has(file) || isTestFile(file)) continue;
    const main = topLevelMain(ir);
    if (!main && !executesAtTop(ir)) continue;
    progOut.push({
      id: `${file}:${main ? "main" : "module"}`, kind: "cli", file, irNodeId: main ? main.id : "module",
      qualifiedName: `${ir.modulePath ?? file}:${main ? "main" : "module"}`, label: file.split("/").pop(),
      summary: `runs when loaded: ${signals.map((s) => SIGNAL_WORDS[s] ?? s).join(", ")}${main ? " — main() entry" : ""}`,
      framework: "node", metadata: { seed: main ? "main" : "module", signals },
    });
  }
  return [...pkgOut, ...out, ...progOut];
}

const SIGNAL_WORDS = { await: "a top-level await", listen: "a .listen() call", argv: "reads process.argv" };

const isMain = process.argv[1] && /discover_project\.mjs$/.test(process.argv[1]);
if (isMain) {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) raw += chunk;
  const { files, entryPoints, manifests } = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ entryPoints: discoverProject(files ?? {}, entryPoints ?? [], manifests ?? []) }));
}
