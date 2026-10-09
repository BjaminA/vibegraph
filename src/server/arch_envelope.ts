// M-ARCH.1 — the architecture model for one envelope: the contracts
// computed the way the export computes them (quality/facts.ts's options),
// and the package roots read from disk. Kept apart from arch_model.ts so
// that module stays pure.

import { registeredAccess } from "./registered_access.ts";
import { applyArchStore, loadArchStore } from "./arch_store.ts";
import * as fs from "fs";
import * as path from "path";
import { buildArchModel } from "./arch_model.ts";
import { deriveFileStores } from "./arch_stores.ts";
import { stampHierarchy } from "../shared/arch_hierarchy.ts";
import { readInfraManifests } from "./infra_manifests.ts";
import { computeThreadContract, type ThreadContract } from "./thread_contract.ts";
import { contractOptsFor } from "./quality/facts.ts";
import type { StackIndex } from "./stack.ts";
import type { ArchModelRecord, CrossingIndexRecord, EntryPoint } from "../shared/protocol.ts";
import { loadConstraints } from "./constraint_store.ts";
import { readObservations } from "./observations.ts";
import { observationsForNode } from "../shared/observations.ts";
import { deriveDataZones } from "./arch_data_zones.ts";
import { loadPlan } from "./plan_store.ts";
import { stampServed } from "./arch_served.ts";
import { stampIdentity } from "./arch_identity.ts";
import { negativeGlobs } from "./operation_vocab.ts";
import { recordModelSource } from "./model_source.ts";
import { listSpecs } from "./software_store.ts";
import { declaredTopology } from "./arch_label_drift.ts";
import { claimEdges } from "./claim_store.ts";
import { declaredFeeds, feedEdges } from "./topology_feeds.ts";
import { observedOps, withObserved } from "./trace_runs.ts";
import { linesReader } from "./node_scope.ts";

const MANIFESTS = ["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod", "requirements.txt"];

/** Every project-relative directory, among the parsed files' ancestors, that
 *  holds a package manifest. "" when the root does. Read, never guessed. */
export function manifestDirsFor(root: string | null, files: string[]): string[] {
  if (!root) return [];
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 0; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const out: string[] = [];
  for (const d of [...dirs].sort()) {
    if (d.split("/").some((s) => s === "node_modules" || s.startsWith("."))) continue;
    if (MANIFESTS.some((m) => fs.existsSync(path.join(root, d, m)))) out.push(d);
  }
  return out;
}

export interface ArchEnvelopeLike {
  files: Record<string, { nodes?: any[]; language?: string }>;
  entryPoints: EntryPoint[];
  threads: Array<{ entryPointId?: string | null; filesReached?: string[] } & Record<string, any>>;
}

export function archModelForEnvelope(
  env: ArchEnvelopeLike, stack: StackIndex, crossings: CrossingIndexRecord | null, root: string | null,
  contractFor?: (ep: string) => ThreadContract | null,
  opts2: { applyStore?: boolean } = {},
): ArchModelRecord {
  const derived = recordModelSource(derivedArchModel(env, stack, crossings, root, contractFor), { files: env.files, stack, threads: env.threads });
  // M-ARCH.4 — the stated half and any pending proposal, each element
  // keeping its source. The server holds the derived model apart so a
  // ratify/reject re-applies without re-deriving.
  return opts2.applyStore === false || !root ? derived : applyArchStore(derived, loadArchStore(root));
}

function derivedArchModel(
  env: ArchEnvelopeLike, stack: StackIndex, crossings: CrossingIndexRecord | null, root: string | null,
  contractFor?: (ep: string) => ThreadContract | null,
): ArchModelRecord {
  const opts = contractOptsFor(env as never, stack);
  const threadByEp = new Map(env.threads.filter((t) => t.entryPointId).map((t) => [t.entryPointId as string, t]));
  const memo = new Map<string, ThreadContract | null>();
  const compute = contractFor ?? ((ep: string) => {
    if (memo.has(ep)) return memo.get(ep)!;
    const t = threadByEp.get(ep);
    let c: ThreadContract | null = null;
    try { c = t ? computeThreadContract(t as never, opts as never) : null; } catch { c = null; }
    memo.set(ep, c);
    return c;
  });
  const built = buildArchModel({
    entryPoints: env.entryPoints,
    threads: env.threads,
    stack: stack as never,
    crossings,
    contractFor: compute,
    fileOfNode: opts.fileOfNode,
    manifestDirs: manifestDirsFor(root, Object.keys(env.files)),
    languageOf: (f) => (typeof env.files[f]?.language === "string" ? env.files[f].language! : null),
    signalsOf: (f) => ((env.files[f] as { programSignals?: string[] } | undefined)?.programSignals ?? []),
    // M-ARCH.3 — the payload lens's inputs.
    nodeFor: opts.nodeFor,
    fileNodes: (f) => (env.files[f]?.nodes as never) ?? null,
    constraints: root ? loadConstraints(root) : [],
    observedFor: (() => {
      if (!root) return undefined;
      let store: ReturnType<typeof readObservations> | null = null;
      try { store = readObservations(root); } catch { store = null; }
      if (!store || !Object.keys(store.runs ?? {}).length) return undefined;
      return (file: string, nodeId: string) => observationsForNode(store as never, file, nodeId);
    })(),
  });
  // 2026-10-06 — which processes answer calls from outside (arch_served.ts).
  const model = stampIdentity(stampServed(built, env.entryPoints, env.files as never), env.files as never, env.threads, crossings);
  // Shared file stores (a directory several processes use through an
  // environment variable) — derived from the IR and the .env examples.
  if (!root) return stampHierarchy(model);
  let infra: ReturnType<typeof readInfraManifests>["facts"] = [];
  try { infra = readInfraManifests(root).facts; } catch { infra = []; }
  const stores = deriveFileStores({ files: env.files as never, infra, threads: env.threads, model });
  // 2026-10-02 — the zones of the data stores the code writes, reads and watches
  let zones: ReturnType<typeof deriveDataZones> = { nodes: [], edges: [], notes: [] };
  let specs: ReturnType<typeof listSpecs> = [];
  try { specs = listSpecs(root); } catch { specs = []; }
  try { zones = deriveDataZones({ files: env.files, threads: env.threads, stack, model, plan: loadPlan(root), negative: negativeGlobs(root), registered: registeredAccess(root), declared: declaredTopology(root).topology, specs }); } catch { /* best effort */ }
  const extra = { nodes: [...stores.nodes, ...zones.nodes], edges: [...stores.edges, ...zones.edges], notes: [...stores.notes, ...zones.notes] };
  if (!extra.nodes.length) return stampHierarchy(model);
  const withZones = { ...model, nodes: [...model.nodes, ...extra.nodes], edges: [...model.edges, ...extra.edges], notes: [...model.notes, ...extra.notes] };
  // 2026-10-08 — what a person agreed the code does at run time (claim_store.ts)
  let claimed: ArchModelRecord["edges"] = [];
  try { claimed = claimEdges(root, withZones, linesReader(root)); } catch { claimed = []; }
  // and what the project's topology declares it reaches at run time (topology_feeds.ts)
  try { claimed = [...claimed, ...feedEdges(declaredFeeds(declaredTopology(root).topology, withZones, loadPlan(root), env.files), withZones)]; } catch { /* best effort */ }
  const known = claimed.length ? { ...withZones, edges: [...withZones.edges, ...claimed] } : withZones;
  // and what recorded runs saw (trace_runs.ts): confirmed, or observed
  let runs: ReturnType<typeof observedOps> = [];
  try { runs = observedOps(root, known); } catch { runs = []; }
  return stampHierarchy(withObserved(known, runs));
}
