// `vibegraph-knowledge seeds` (2026-09-25) — the entry points a person names,
// `.vibegraph/manual_seeds.json`: a function or a script the discoverer
// cannot see (a module-private helper, a script run by a cron line outside
// the repo). A seed becomes a THREAD, and so a contract in the export.
// Zero tokens.
//
//   seeds list [<root>]
//   seeds add <file>[:<function or Class>] [<root>] [--note "<why>"]
//   seeds remove <file>[:<function or Class>] [<root>]
//
// `<file>` alone names the file's top level (a script of statements).
// A seed is RESOLVED against the parsed project before it is written, with
// the same function the envelope builder uses (readManualSeeds), and refused
// when it would not become a thread — the file would otherwise carry a seed
// that silently produced nothing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readManualSeeds, resolveManualSeeds } from "../../src/server/manual_seeds.ts";
import { loadEnvelope } from "../quality_check.mjs";

export const SEEDS_USAGE = `seeds list|add|remove [...]                 entry points a person names (.vibegraph/manual_seeds.json); zero tokens
      list [<root>]
      add <file>[:<function|Class>] [<root>] [--note "<why>"]   a bare <file> names its top level
      remove <file>[:<function|Class>] [<root>]`;

const seedsPath = (root) => join(root, ".vibegraph", "manual_seeds.json");

function readRaw(root) {
  const p = seedsPath(root);
  if (!existsSync(p)) return [];
  const raw = JSON.parse(readFileSync(p, "utf-8"));
  return Array.isArray(raw) ? raw : Array.isArray(raw?.seeds) ? raw.seeds : [];
}
function writeRaw(root, seeds) {
  const p = seedsPath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ seeds }, null, 2) + "\n");
}

/** `file.py:name` → { file, name }; a Windows drive letter is not a separator. */
function splitSpec(spec) {
  const i = spec.lastIndexOf(":");
  return i > 1 ? { file: spec.slice(0, i), name: spec.slice(i + 1) } : { file: spec, name: null };
}

/** The IR node id for `name` in `file`: exactly one function or class, or a reason. */
function nodeIdFor(ir, name) {
  const hits = (ir.nodes ?? []).filter((n) => (n.type === "function_def" || n.type === "class_def") && (n.name === name || n.id === name));
  if (hits.length === 1) return { id: hits[0].id };
  if (!hits.length) return { error: `no function or class named ${name} in this file` };
  return { error: `${hits.length} definitions named ${name} (${hits.map((h) => h.id).join(", ")}) — pass the node id instead` };
}

/** @returns {{ lines: string[], messages: string[], exitCode: number }} */
export function runSeeds({ root, sub, spec, values, envelope, pipeline }) {
  const lines = [];
  const messages = [];
  let current;
  try { current = readRaw(root); }
  catch (e) { return { lines, messages: [`${seedsPath(root)} is not readable JSON: ${e.message}`], exitCode: 2 }; }
  if (!["list", "add", "remove"].includes(sub)) return { lines, messages: [`unknown seeds subcommand: ${sub ?? "(none)"} — list, add or remove`], exitCode: 2 };
  if (sub !== "list" && !spec) return { lines, messages: [`${sub} needs <file>[:<function|Class>]`], exitCode: 2 };

  const { envelope: env } = loadEnvelope(root, envelope, pipeline ?? {});
  if (sub === "list") {
    if (!current.length) { lines.push("no named entry points (.vibegraph/manual_seeds.json)"); return { lines, messages, exitCode: 0 }; }
    const { seeds, unresolved } = readManualSeeds(root, env.files);
    for (const s of seeds) lines.push(`${s.id}  → a thread (${s.irNodeId})`);
    for (const u of unresolved) lines.push(`${u.seed}  NOT RESOLVED: ${u.reason}`);
    return { lines, messages, exitCode: unresolved.length ? 1 : 0 };
  }

  const { file, name } = splitSpec(spec);
  const ir = env.files[file];
  if (!ir) return { lines, messages: [`${file} is not a parsed file of this project (check the path is relative to the root, and the language is registered)`], exitCode: 1 };
  let irNodeId = "module";
  if (name) {
    const r = nodeIdFor(ir, name);
    if (r.error) return { lines, messages: [`${spec}: ${r.error}`], exitCode: 1 };
    irNodeId = r.id;
  }
  const same = (s) => s?.file === file && s?.irNodeId === irNodeId;

  if (sub === "remove") {
    const next = current.filter((s) => !same(s));
    if (next.length === current.length) return { lines, messages: [`${file}:${irNodeId} is not a named seed`], exitCode: 1 };
    writeRaw(root, next);
    lines.push(`removed ${file}:${irNodeId}`);
    return { lines, messages, exitCode: 0 };
  }
  if (current.some(same)) return { lines, messages: [`${file}:${irNodeId} is already named`], exitCode: 1 };
  const entry = { file, irNodeId, ...(values.note ? { comment: values.note } : {}) };
  // Resolve before writing: a seed that would not become a thread is refused.
  const probe = readManualSeeds(root, env.files);
  const test = resolveManualSeeds([entry], env.files);
  if (test.unresolved.length) return { lines, messages: [`refused ${file}:${irNodeId}: ${test.unresolved[0].reason}`], exitCode: 1 };
  writeRaw(root, [...current, entry]);
  lines.push(`named ${test.seeds[0].id} (${irNodeId}) — it becomes a thread on the next export`);
  if (probe.unresolved.length) messages.push(`note: ${probe.unresolved.length} earlier seed(s) do not resolve — see \`seeds list\``);
  return { lines, messages, exitCode: 0 };
}
