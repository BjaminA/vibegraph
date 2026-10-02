// The DATA ARCHITECTURE, derived from the IR (2026-10-02). One entry point,
// `deriveDataArchitecture`, over the per-file IR: literal tables (module 1),
// name patterns (2), SDK effects (3), injected capabilities (4), resources and
// zones (5), data-coupled hops (6), decision structures (7). Zero tokens;
// every item cites file:line; what cannot be reduced is listed in `computed`,
// never guessed. See src/shared/data_arch_types.ts.

import type { DataArchitecture, TableDecl } from "../shared/data_arch_types.ts";
import type { Topology, TopoRouter } from "../shared/topology_types.ts";
import { TOPOLOGY_VERSION } from "../shared/topology_types.ts";
import { decisionTreesFrom, stateMachinesFrom } from "./decision_tables.ts";
import { scanSdkCalls, type StackLike } from "./sdk_effects.ts";
import { importResolver, injectionsOf } from "./injections.ts";
import { NameEvaluator } from "./name_patterns.ts";
import { applyTransforms, fill, transformsOf } from "../shared/name_pattern.ts";
import { dataOps, familiesFrom, hopsFrom, topologyParts } from "./data_topology.ts";
import { isTestFile } from "../shared/path_match.ts";
import { applyWriterOverrides } from "./grant_overrides.ts";

interface IrFile { nodes?: Array<Record<string, any>> }
export type IrFiles = Record<string, IrFile>;
interface ThreadLike { entryPointId: string; seed?: { file?: string }; nodes?: Array<{ id: string; file?: string | null; irNodeId?: string }> }

/** Every literal table the parsers lifted, with where it is. */
export function collectTables(files: IrFiles): TableDecl[] {
  const out: TableDecl[] = [];
  for (const [file, ir] of Object.entries(files)) {
    if (isTestFile(file)) continue; // a test's tables are fixtures, not declarations
    for (const n of ir.nodes ?? []) {
      if (n.type === "assignment" && n.table && !n.parentId) out.push({ file, name: n.name, line: n.line, table: n.table });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** A reference to a list table, resolved: the same file first, else a unique name. */
export function listResolver(tables: TableDecl[]): (file: string, ref: string) => string[] | null {
  return (file, ref) => {
    const lists = tables.filter((t) => t.name === ref && t.table.shape === "list");
    const hit = lists.find((t) => t.file === file) ?? (lists.length === 1 ? lists[0] : undefined);
    return hit ? (hit.table.values ?? []).filter((v): v is string => typeof v === "string") : null;
  };
}

/** Functions that read a catalogue (its name appears in a node inside them). */
function readersOfTable(files: IrFiles, name: string): string[] {
  const out = new Set<string>();
  const word = new RegExp(`\\b${name}\\b`);
  for (const [file, ir] of Object.entries(files)) {
    const byId = new Map((ir.nodes ?? []).map((n) => [n.id, n]));
    for (const n of ir.nodes ?? []) {
      if (n.type === "function_def" || !n.parentId) continue;
      if (!word.test(JSON.stringify([n.iter, n.value, n.args, n.callTarget, n.funcName, n.preview, n.condition]))) continue;
      let p = byId.get(n.parentId);
      while (p && p.type !== "function_def") p = byId.get(p.parentId);
      if (p) out.add(`\`${p.name}\` (${file}:${p.line})`);
    }
  }
  return [...out];
}

export function deriveDataArchitecture(files: IrFiles, stack: StackLike = {}, threads: ThreadLike[] = []): DataArchitecture {
  const tables = collectTables(files);
  const lists = listResolver(tables);
  const topology: Topology = { version: TOPOLOGY_VERSION };
  const computed: string[] = [];

  // 2–4. names, SDK effects, injections
  const ev = new NameEvaluator(files as any, importResolver(files as any));
  const sdk = scanSdkCalls(files as any, stack);
  for (const c of sdk.calls) {
    if (c.effect === "call") continue; // a factory or lifecycle call names no resource
    const node = (files[c.file]?.nodes ?? []).find((n) => n.line === c.line && (n.funcName ?? n.callTarget) === c.callee);
    const v = node ? ev.ofOperation(c.file, node as any) : null;
    if (v?.pattern) c.name = v.pattern;
    else if (v?.computedAt) c.computedAt = v.computedAt;
  }
  const inj = injectionsOf(files as any);
  computed.push(...sdk.untied, ...inj.unresolved);

  // 5–6. resources, zones, data operations, hops
  const read = familiesFrom(tables, lists);
  const { catalogue, namingKeys } = read;
  // M3: the writers the code's own function decides, not only its input table
  const ov = applyWriterOverrides(files as any, catalogue, read.families);
  const families = ov.families;
  computed.push(...ov.computed);
  const ops = dataOps(files as any, ev, families, namingKeys, inj.injections, threads, new Set(sdk.calls.map((c) => `${c.file}:${c.line}:${c.callee}`)));
  const flows = hopsFrom(ops);
  let resourceNaming: ReturnType<NameEvaluator["resourceNaming"]> = null;
  if (families.length) {
    const routers = new Map<string, TopoRouter>();
    for (const o of ops) for (const v of o.via ?? []) {
      const m = /^(\S+) \((.+):(\d+)\)$/.exec(v);
      if (m && !routers.has(m[1])) routers.set(m[1], { function: m[1], file: m[2], cite: `${m[2]}:${m[3]}` });
    }
    for (const p of ev.patterns()) {
      const def = (files[p.file]?.nodes ?? []).find((n) => n.type === "function_def" && n.name === p.fn);
      if (def?.returnsPattern?.transformed && !routers.has(p.fn)) routers.set(p.fn, { function: p.fn, file: p.file, cite: `${p.file}:${p.line}` });
    }
    const roles = Object.fromEntries((stack.tools ?? []).map((t) => [t.tool, t.role]));
    const parts = topologyParts(families, sdk.calls, roles, [...routers.values()]);
    // M2: each zone's resource name, when a builder names zones from configuration
    const naming = ev.resourceNaming();
    if (naming) {
      const ts = transformsOf(naming.chain ?? "");
      for (const z of parts.zones) {
        const typed = applyTransforms(fill(naming.pattern, { [naming.zoneHole]: z.id }), ts);
        const resolved = typed.replace(/\{[A-Z_][A-Z0-9_]*=([^}]*)\}/g, "$1");
        z.label = `${resolved} (${typed.replace(/\{([A-Z_][A-Z0-9_]*)=[^}]*\}/g, "{$1}")}, named by ${naming.fn} at ${naming.cite})`;
      }
      resourceNaming = naming;
    }
    Object.assign(topology, parts);
    if (!parts.routers.length) delete (topology as Partial<Topology>).routers;
    const builders = catalogue ? readersOfTable(files, catalogue.name) : [];
    if (catalogue && builders.length) {
      computed.push(`zone writers are read from the catalogue's writer field (${catalogue.name}, ${catalogue.file}:${catalogue.line}); ${builders.slice(0, 6).join(", ")} read${builders.length === 1 ? "s" : ""} it at run time and may add or replace writers there`);
    }
  }

  // 7. decision structures
  const stateMachines = stateMachinesFrom(tables, files, lists);
  const decisionTrees = decisionTreesFrom(tables);
  if (stateMachines.length) topology.stateMachines = stateMachines;
  if (decisionTrees.length) topology.decisionTrees = decisionTrees;

  return {
    version: "1",
    tables: tables.map((t) => ({
      file: t.file, name: t.name, line: t.line, shape: t.table.shape,
      rows: (t.table.rows ?? t.table.values ?? []).length,
      fields: [...new Set((t.table.rows ?? []).flatMap((r) => Object.keys(r.fields ?? {})))],
    })),
    namePatterns: ev.patterns(),
    ...(resourceNaming ? { resourceNaming } : {}),
    sdkCalls: sdk.calls,
    injections: inj.injections,
    topology,
    flows,
    ...(ov.notes.length ? { writerOverrides: ov.notes } : {}),
    operations: ops.map(({ fnId: _fnId, ...o }) => o),
    computed,
  };
}
