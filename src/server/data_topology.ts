// RESOURCES, ZONES AND DATA-COUPLED FLOWS (2026-10-02, modules 5 and 6),
// derived from literal tables (module 1), name patterns (2), SDK effects (3)
// and injected capabilities (4).
//
//   a CATALOGUE  a rows table whose rows name a resource (a path / topic /
//                key / prefix field) and who writes or reads it → one family
//                per row, its writers and readers as grants;
//   a NAMING     a record whose keys are the catalogue's resource patterns and
//                whose values are names → each family's zone (a hole in the
//                key filled by the row's literal: `record_{Type}` →
//                `record_CandidateTarget`);
//   a DATA OP    a call whose verb writes / reads / watches and whose name
//                argument reduces to a family's pattern — through the project's
//                own funnel as much as through the SDK — reported at the call,
//                and ALSO at every call through an injected port that reaches
//                it (that is where the logic does its I/O); and a call passing
//                a zone's literal name to a function that watches or reads;
//   a HOP        a family written in one process and watched or read in
//                another: the processes meet in data, and the ORDER is not
//                proven by the code.
//
// Field names are taxonomy tables; nothing keys on the project's words.

import type { DataHop, Injection, SdkCall } from "../shared/data_arch_types.ts";
import type { TopoFamily, TopoGrant, TopoRouter, TopoStore, TopoZone } from "../shared/topology_types.ts";
import type { TableDecl, TableRow } from "../shared/data_arch_types.ts";
import { asNames } from "./decision_tables.ts";
import { effectOf, verbWords, VERB_EFFECTS } from "../shared/sdk_verbs.ts";
import { isTestFile } from "../shared/path_match.ts";
import { covers, holeValues, shapeOf } from "../shared/name_pattern.ts";
import type { NameEvaluator, NameValue } from "./name_patterns.ts";

export const RESOURCE_FIELDS = {
  path: ["path", "pattern", "topic", "key", "prefix", "table", "collection", "resource", "route", "channel", "queue", "bucket", "subject", "stream"],
  writers: ["write", "writers", "writer", "producers", "producer", "owners", "owner", "writeRoles", "writableBy"],
  readers: ["read", "readers", "reader", "consumers", "consumer", "readRoles", "readableBy", "subscribers"],
} as const;

const fieldOf = (r: TableRow, names: readonly string[]) => { for (const k of names) if (r.fields && k in r.fields) return r.fields[k]; return undefined; };
const norm = shapeOf;
export { covers };

export interface Family { id: string; pattern: string; zone: string; writers: string[]; readers: string[]; cite: string }
export interface DataOp { file: string; line: number; op: "write" | "read" | "watch"; family: string; via?: string[]; port?: string; entries: string[]; fnId?: string }

export function familiesFrom(tables: TableDecl[], lists: (file: string, ref: string) => string[] | null): { families: Family[]; catalogue: TableDecl | null; naming: TableDecl | null; namingKeys: NamingKeys } {
  const catalogues = tables.filter((d) => d.table.shape === "rows" && (d.table.rows?.length ?? 0) >= 2
    && d.table.rows!.every((r) => typeof fieldOf(r, RESOURCE_FIELDS.path) === "string")
    && d.table.rows!.filter((r) => fieldOf(r, RESOURCE_FIELDS.writers) !== undefined || fieldOf(r, RESOURCE_FIELDS.readers) !== undefined).length >= d.table.rows!.length / 2);
  const families: Family[] = [];
  let firstCat: TableDecl | null = null, firstNaming: TableDecl | null = null;
  for (const cat of catalogues) {
    const paths = cat.table.rows!.map((r) => fieldOf(r, RESOURCE_FIELDS.path) as string);
    const naming = tables
      .filter((d) => d.table.shape === "record" && (d.table.rows ?? []).every((r) => typeof r.value === "string"))
      .map((d) => ({ d, hit: (d.table.rows ?? []).filter((r) => paths.some((p) => covers(r.key!, p))).length }))
      .filter((x) => x.hit >= Math.max(2, (x.d.table.rows?.length ?? 0) / 2))
      .sort((a, b) => b.hit - a.hit)[0]?.d ?? null;
    firstCat ??= cat; firstNaming ??= naming;
    for (const r of cat.table.rows!) {
      const path = fieldOf(r, RESOURCE_FIELDS.path) as string;
      let name = path;
      if (naming) {
        const exact = naming.table.rows!.find((k) => k.key === path) ?? naming.table.rows!.find((k) => norm(k.key!) === norm(path));
        const general = exact ?? naming.table.rows!.find((k) => covers(k.key!, path));
        if (general) {
          const vals = holeValues(general.key!, path) ?? {};
          name = String(general.value).replace(/\{([^}]*)\}/g, (w, h) => (vals[h] && !/^\{/.test(vals[h]) ? vals[h] : w));
        }
      }
      families.push({
        id: name, pattern: path, zone: name,
        writers: asNames(fieldOf(r, RESOURCE_FIELDS.writers), (ref) => lists(cat.file, ref)) ?? [],
        readers: asNames(fieldOf(r, RESOURCE_FIELDS.readers), (ref) => lists(cat.file, ref)) ?? [],
        cite: `${cat.file}:${r.line}`,
      });
    }
  }
  const namingKeys: NamingKeys = (firstNaming?.table.rows ?? []).map((r) => ({ key: r.key!, value: String(r.value) }));
  return { families, catalogue: firstCat, naming: firstNaming, namingKeys };
}

interface IrNode { id: string; type: string; parentId?: string | null; line?: number; name?: string; funcName?: string; callTarget?: string; args?: string[]; params?: string[] }
type Files = Record<string, { nodes?: IrNode[] }>;
interface ThreadLike { entryPointId: string; seed?: { file?: string }; nodes?: Array<{ id: string; file?: string | null; irNodeId?: string }> }

/** A naming record's entries: a general resource pattern → its zone name (`…/records/{Type}/…` → `record_{Type}`). */
export type NamingKeys = Array<{ key: string; value: string }>;

/** The zone a reduced NAME belongs to: a catalogue row's pattern, else a naming key's.
 *  A bare word equal to a zone's name is not enough here (`add("x", …)` adds to a map). */
export function zoneOfName(pattern: string, families: Family[], naming: NamingKeys): string | null {
  const f = families.find((x) => norm(x.pattern) === norm(pattern)) ?? families.find((x) => covers(x.pattern, pattern));
  if (f) return f.zone;
  const k = naming.find((x) => norm(x.key) === norm(pattern)) ?? naming.find((x) => covers(x.key, pattern));
  return k ? k.value : null;
}

const OP_OF: Record<string, DataOp["op"] | undefined> = { write: "write", admin: "write", read: "read", watch: "watch" };

export function dataOps(files: Files, ev: NameEvaluator, families: Family[], naming: NamingKeys, injections: Injection[], threads: ThreadLike[], sdkSites: Set<string> = new Set()): DataOp[] {
  const ops: DataOp[] = [];
  const fnOf = (file: string, n: IrNode): IrNode | undefined => {
    const byId = new Map((files[file]?.nodes ?? []).map((x) => [x.id, x]));
    let p = byId.get(n.parentId ?? "");
    while (p && p.type !== "function_def") p = byId.get(p.parentId ?? "");
    return p;
  };
  // entry files per (file, function id) — which processes reach it
  const reach = new Map<string, Set<string>>();
  for (const t of threads) {
    const entry = t.seed?.file ?? t.entryPointId.split(":")[0];
    if (isTestFile(entry)) continue; // a test is not a process
    for (const n of t.nodes ?? []) {
      if (!n.file || !n.irNodeId) continue;
      const k = `${n.file}::${n.irNodeId}`;
      if (!reach.has(k)) reach.set(k, new Set());
      reach.get(k)!.add(entry);
    }
  }
  // module-level code runs when its script runs: the entries seeded in that file
  const seededIn = new Map<string, Set<string>>();
  for (const t of threads) {
    const entry = t.seed?.file ?? t.entryPointId.split(":")[0];
    if (isTestFile(entry)) continue;
    if (!seededIn.has(entry)) seededIn.set(entry, new Set());
    seededIn.get(entry)!.add(entry);
  }
  const entriesAt = (file: string, fn?: IrNode) => [...(fn ? reach.get(`${file}::${fn.id}`) : reach.get(`${file}::module`) ?? seededIn.get(file)) ?? []].sort();
  const zoneIds = new Set([...families.map((f) => f.zone), ...naming.map((k) => k.value)]);
  // functions whose body watches/reads/writes (for a literal zone name passed to them)
  const bodyOp = new Map<string, DataOp["op"]>();
  for (const [file, ir] of Object.entries(files)) for (const n of ir.nodes ?? []) {
    const callee = String(n.funcName ?? n.callTarget ?? "");
    const op = OP_OF[effectOf(callee.split(".").pop() ?? "")];
    if (!op || !callee.includes(".")) continue;
    // a DATA operation, not a collection method: an SDK call, or a call through
    // one of the enclosing functions' own parameters (`boundaries.meta(b).watch`)
    const root = /^[\s(]*(?:await\s+)?([A-Za-z_$][\w$]*)/.exec(callee)?.[1] ?? "";
    const isSdk = sdkSites.has(`${file}:${n.line}:${callee}`);
    const chain: IrNode[] = [];
    for (let fn = fnOf(file, n), hops = 0; fn && hops < 4; fn = fnOf(file, fn), hops++) chain.push(fn);
    const viaParam = chain.some((fn) => (fn.params ?? []).some((p) => String(p).replace(/^\.\.\./, "").split(/[?:=\s]/)[0] === root));
    if (!isSdk && !viaParam) continue;
    // every enclosing function operates (an arrow it returns does the work for it)
    for (const fn of chain) {
      const k = `${file}::${fn.name}`;
      if (bodyOp.get(k) !== "watch") bodyOp.set(k, op);
    }
  }
  for (const [file, ir] of Object.entries(files)) {
    if (isTestFile(file)) continue;
    for (const n of ir.nodes ?? []) {
      const callee = String(n.funcName ?? n.callTarget ?? "");
      if (!callee) continue;
      const method = callee.split(".").pop() ?? "";
      const op = OP_OF[effectOf(method)];
      const fn = fnOf(file, n);
      if (op && VERB_EFFECTS[verbWords(method)[0] ?? ""]) {
        const name: NameValue | null = ev.ofOperation(file, n as any);
        const zone = name?.pattern ? zoneOfName(name.pattern, families, naming) : null;
        if (zone) { ops.push({ file, line: n.line ?? 0, op, family: zone, ...(name!.via ? { via: name!.via } : {}), entries: entriesAt(file, fn), ...(fn ? { fnId: fn.id } : {}) }); continue; }
      }
      // a zone's literal name passed to a project function that operates on it
      if (/^[A-Za-z_$][\w$]*$/.test(callee)) {
        const lits = (n.args ?? []).flatMap((a) => [...a.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1])).filter((s) => zoneIds.has(s));
        const def = lits.length ? ev.fnDef(file, callee) : null;
        const inner = def ? bodyOp.get(`${def.file}::${def.node.name}`) : undefined;
        if (inner) for (const z of lits) ops.push({ file, line: n.line ?? 0, op: inner, family: z, via: [`${callee} (${def!.file}:${def!.node.line})`], entries: entriesAt(file, fn) });
      }
    }
  }
  // through injected ports: the logic's call site does the I/O its implementation does
  for (const j of injections) {
    for (const impl of j.implementations.filter((i) => !i.test)) {
      const implFn = (files[impl.file]?.nodes ?? []).find((x) => x.type === "function_def" && Math.abs((x.line ?? 0) - impl.line) <= 1 && !!x.name && impl.fn.endsWith(x.name));
      if (!implFn) continue;
      const inside = ops.filter((o) => o.file === impl.file && o.fnId === implFn.id && !o.port);
      for (const o of inside) for (const c of j.calls) {
        const n = (files[c.file]?.nodes ?? []).find((x) => x.line === c.line && String(x.funcName ?? x.callTarget ?? "").replace(/\?\.?/g, ".").startsWith(c.callee.split(".")[0]));
        ops.push({ file: c.file, line: c.line, op: o.op, family: o.family, port: `${j.iface}.${j.property}`, entries: entriesAt(c.file, n ? fnOf(c.file, n) : undefined) });
      }
    }
  }
  return dedupe(ops);
}

function dedupe(ops: DataOp[]): DataOp[] {
  const seen = new Set<string>();
  return ops.filter((o) => { const k = `${o.file}:${o.line}:${o.op}:${o.family}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function hopsFrom(ops: DataOp[]): DataHop[] {
  const out: DataHop[] = [];
  const writes = ops.filter((o) => o.op === "write");
  const reads = ops.filter((o) => o.op !== "write");
  const same = (a: string, b: string) => a === b || covers(a, b) || covers(b, a);
  for (const w of writes) for (const r of reads) {
    if (!same(w.family, r.family) || !w.entries.length || !r.entries.length) continue;
    if (r.entries.every((e) => w.entries.includes(e)) && w.entries.every((e) => r.entries.includes(e))) continue;
    out.push({
      family: w.family,
      from: { op: "write", file: w.file, line: w.line, entries: w.entries },
      to: { op: r.op as "watch" | "read", file: r.file, line: r.line, entries: r.entries },
      note: `${w.port ? `through ${w.port}; ` : ""}${r.port ? `read through ${r.port}; ` : ""}no call joins them, and the order is not proven`,
    });
  }
  return out;
}

export function topologyParts(families: Family[], sdkCalls: SdkCall[], storeRoles: Record<string, string>, routers: TopoRouter[]): { stores: TopoStore[]; zones: TopoZone[]; families: TopoFamily[]; grants: TopoGrant[]; routers: TopoRouter[] } {
  // the store: the data tool most of the project's SDK writes and watches go to
  const tally = new Map<string, number>();
  for (const c of sdkCalls) if (!(c as any).test && ["write", "watch", "read", "admin", "grant"].includes(c.effect) && ["platform", "db", "queue", "cloud", "cache"].includes(storeRoles[c.tool] ?? "")) tally.set(c.tool, (tally.get(c.tool) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const storeId = top?.[0] ?? "store";
  const first = sdkCalls.find((c) => c.tool === storeId);
  const stores: TopoStore[] = [{ id: storeId, kind: top ? storeRoles[storeId] : "not attributed to a tool", ...(first ? { cite: `${first.file}:${first.line}` } : {}) }];
  const zones = new Map<string, TopoZone>();
  const grants: TopoGrant[] = [];
  const topoFams: TopoFamily[] = [];
  for (const f of families) {
    const z = zones.get(f.zone) ?? { id: f.zone, store: storeId, holds: [], cite: f.cite };
    z.holds!.push(f.pattern);
    zones.set(f.zone, z);
    topoFams.push({ id: f.zone === f.pattern ? f.pattern : f.zone, pattern: f.pattern, zone: f.zone, cite: f.cite });
    for (const w of f.writers) if (!grants.some((g) => g.who === `role:${w}` && g.zone === f.zone && g.access === "write")) grants.push({ who: `role:${w}`, zone: f.zone, access: "write", cite: f.cite });
    for (const r of f.readers) if (!grants.some((g) => g.who === `role:${r}` && g.zone === f.zone && g.access === "read")) grants.push({ who: `role:${r}`, zone: f.zone, access: "read", cite: f.cite });
  }
  // a family id must be unique: several rows sharing one zone keep their patterns as ids
  const ids = new Map<string, number>();
  for (const f of topoFams) ids.set(f.id, (ids.get(f.id) ?? 0) + 1);
  for (const f of topoFams) if ((ids.get(f.id) ?? 0) > 1) f.id = f.pattern!;
  return { stores, zones: [...zones.values()], families: topoFams, grants, routers };
}
