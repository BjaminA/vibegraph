// M-CMD.1 / M-ARCH.2 — `.vibegraph/manual_seeds.json`: a person's named
// entry points, in ANY language. Shared by the CLI's envelope builder
// (scripts/regen_polyglot.mjs) and the live server, which until M-ARCH.2
// handed seeds to the Python discoverer only — so a bash or TS seed that
// worked in the exported knowledge never appeared in the GUI.
//
// Shape (both accepted): `{"seeds": [{file, irNodeId}]}` or a bare array.
// `irNodeId: "module"` names the file's top level (M-FLOW.1).

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface ManualSeedEntry {
  id: string;
  kind: "manual";
  file: string;
  irNodeId: string;
  qualifiedName: string;
  label: string;
  summary: string;
  framework: null;
  metadata?: { seed: "module" };
}

export function readManualSeeds(
  root: string,
  files: Record<string, { nodes?: any[]; modulePath?: string }>,
): { seeds: ManualSeedEntry[]; unresolved: { seed: string; reason: string }[] } {
  const p = join(root, ".vibegraph", "manual_seeds.json");
  if (!existsSync(p)) return { seeds: [], unresolved: [] };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(p, "utf-8")); }
  catch (e) { return { seeds: [], unresolved: [{ seed: ".vibegraph/manual_seeds.json", reason: `not readable as JSON: ${(e as Error).message}` }] }; }
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.seeds) ? (raw as any).seeds : [];
  return resolveManualSeeds(list, files);
}

/** Resolve seed entries `{file, irNodeId}` against the parsed files — pure,
 *  so the CLI can check a candidate seed before writing it (2026-09-25). */
export function resolveManualSeeds(
  list: any[],
  files: Record<string, { nodes?: any[]; modulePath?: string }>,
): { seeds: ManualSeedEntry[]; unresolved: { seed: string; reason: string }[] } {
  const seeds: ManualSeedEntry[] = [];
  const unresolved: { seed: string; reason: string }[] = [];
  for (const s of list) {
    const file = s?.file;
    const irNodeId = s?.irNodeId;
    const where = `${file ?? "?"}:${irNodeId ?? "?"}`;
    if (!file || !irNodeId) { unresolved.push({ seed: where, reason: "needs both `file` and `irNodeId`" }); continue; }
    const ir = files[file];
    if (!ir) { unresolved.push({ seed: where, reason: "no such file in the parsed project (is it under a skipped directory, or an unregistered language?)" }); continue; }
    if (irNodeId === "module") {
      const base = file.split("/").pop();
      seeds.push({
        id: `${file}:module`, kind: "manual", file, irNodeId: "module",
        qualifiedName: `${ir.modulePath ?? file}:module`, label: base,
        summary: `${base} — the file's top level, named by a person in .vibegraph/manual_seeds.json`,
        framework: null, metadata: { seed: "module" },
      });
      continue;
    }
    const fn = (ir.nodes ?? []).find((n: any) => n.id === irNodeId);
    if (!fn) { unresolved.push({ seed: where, reason: "no node with that id in the file's IR" }); continue; }
    if (fn.type !== "function_def" && fn.type !== "class_def") {
      unresolved.push({ seed: where, reason: `node is a ${fn.type}, and a thread can only be seeded from a function or a class` });
      continue;
    }
    const doc = typeof fn.docstring === "string" ? fn.docstring.split(/\r?\n/)[0] : null;
    seeds.push({
      id: `${file}:${fn.name}`, kind: "manual", file, irNodeId,
      qualifiedName: `${ir.modulePath ?? file}:${fn.name}`, label: fn.name,
      summary: doc || `${fn.name} — named by a person in .vibegraph/manual_seeds.json`,
      framework: null,
    });
  }
  return { seeds, unresolved };
}
