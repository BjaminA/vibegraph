// Quality layer, Run 3: the QualityFacts builder. PURE over a project
// envelope, a stack index and (optionally) a run delta; no fs, no live
// server state. The first four fields are a port of server.ts's
// buildCheckFacts (the grammar's CheckFacts), unchanged in meaning; the
// rest are the read-only handles Run 2's registry declared.
//
// This is the THIRD site that assembles computeThreadContract's injection
// recipe (server.ts threadContractFor, test/example_fleet.test.mjs, here),
// so `contractOptsFor` is the shared builder. The other two are left as
// they are; a follow-up may point them here.

import type { ReferenceFact, UnresolvedFact } from "../constraint_grammar.ts";
import { computeThreadContract, type ThreadContract, type ContractInputThread } from "../thread_contract.ts";
import { buildStackIndex, contractStackForFile, type StackIndex } from "../stack.ts";
import { buildCrossingIndex } from "../crossings.ts";
import type { FactNode, QualityFacts, RunDelta } from "./check_registry.ts";
import { languageForPath } from "../../shared/languages.ts";

interface IrNodeLike {
  id: string; type: string; parentId?: string | null; line?: number; col?: number;
  name?: string; funcName?: string; callTarget?: string; effectKind?: string | null; paramTypes?: Record<string, string>;
  params?: string[]; condition?: string; elseLine?: number; exceptType?: string | null;
  iterName?: string; valueKind?: string;
}
interface IrEdgeLike { type?: string; source?: string; target?: string; targetFile?: string; qualifiedTarget?: string }
export interface EnvelopeLike {
  files: Record<string, { nodes?: IrNodeLike[]; edges?: IrEdgeLike[]; language?: string }>;
  threads: Array<ContractInputThread & { entryPointId?: string | null }>;
  entryPoints: Array<{ id: string; kind: string; file: string; irNodeId: string; framework?: string | null }>;
}

export interface FactsInput {
  envelope: EnvelopeLike;
  root: string;
  commit: string;
  /** The thread under check, when a verb is thread-scoped. */
  entryPointId?: string;
  /** The files under check, when a verb is file-scoped (a packet's edit scope). */
  scopeFiles?: readonly string[];
  stack?: StackIndex;
  runDelta?: RunDelta | null;
}

/** The server's injection recipe for computeThreadContract, shared. */
export function contractOptsFor(env: EnvelopeLike, stack: StackIndex) {
  const crossings = buildCrossingIndex(env as never);
  // M-ARCH.1 — indexed once. Node ids are structural paths, so the same id
  // recurs across files (`module/main.fn`); the per-file map answers a
  // (file, id) lookup exactly and the global map answers "which file owns
  // this id" with the FIRST file, as the linear scan it replaces did. The
  // scans were O(files × nodes) per call and a 1128-file project makes
  // thousands of calls — most of a 6-minute export.
  const byFile = new Map<string, Map<string, unknown>>();
  const firstFile = new Map<string, string>();
  for (const [f, ir] of Object.entries(env.files)) {
    const m = new Map<string, unknown>();
    for (const n of ir.nodes ?? []) {
      if (!m.has(n.id)) m.set(n.id, n);
      if (!firstFile.has(n.id)) firstFile.set(n.id, f);
    }
    byFile.set(f, m);
  }
  const nodeFor = (file: string | null, irNodeId: string | null) => {
    if (!irNodeId) return null;
    if (file) return (byFile.get(file)?.get(irNodeId) as Record<string, unknown> | undefined) ?? null;
    const f = firstFile.get(irNodeId);
    return f ? (byFile.get(f)!.get(irNodeId) as Record<string, unknown>) : null;
  };
  const fileOfNode = (irNodeId: string) => firstFile.get(irNodeId) ?? null;
  return {
    nodeFor, reaches: [] as string[], reachedBy: [] as string[],
    stackFor: (f: string) => contractStackForFile(stack, f),
    fileOfNode,
    importsFor: (f: string) => stack.importsByFile?.[f] ?? [],
    localsFor: (f: string) => stack.localsByFile?.[f] ?? [],
    handlerFor: (f: string, irNodeId: string) => {
      const fnId = irNodeId.split("/").slice(0, 2).join("/");
      const ep = env.entryPoints.find((e) => e.kind === "route" && e.file === f && e.irNodeId === fnId);
      if (!ep) return null;
      const fn = (env.files[f]?.nodes ?? []).find((n) => n.id === fnId);
      return { framework: ep.framework ?? null, params: fn?.params ?? [] };
    },
    stackIndex: stack,
    crossingsFor: (id: string) => crossings.byThread[id] ?? [],
  };
}

function toFactNode(n: IrNodeLike, resolved: Set<string>): FactNode {
  const out: FactNode = {
    id: n.id, type: n.type, parentId: n.parentId ?? null,
    line: typeof n.line === "number" ? n.line : 0, col: typeof n.col === "number" ? n.col : 0,
  };
  if (n.effectKind !== undefined) out.effectKind = n.effectKind;
  if (n.paramTypes) out.paramTypes = n.paramTypes;
  if (n.params) out.params = n.params;
  if (typeof n.name === "string") out.name = n.name;
  if (typeof n.funcName === "string") out.funcName = n.funcName;
  if (typeof n.callTarget === "string") out.callTarget = n.callTarget;
  if (typeof n.condition === "string") out.condition = n.condition;
  if (typeof n.elseLine === "number") out.elseLine = n.elseLine;
  if (typeof n.iterName === "string") out.iterName = n.iterName;
  if (typeof n.valueKind === "string") out.valueKind = n.valueKind;
  if (n.exceptType !== undefined) out.exceptType = n.exceptType;
  if (n.type === "call" || n.type === "assignment") out.resolved = resolved.has(n.id);
  return out;
}

export function buildQualityFacts(input: FactsInput): QualityFacts {
  const { envelope: env, root, commit } = input;
  const stack = input.stack ?? buildStackIndex(env as never, root);

  // ── the grammar's four fields, as server.ts builds them ──
  const references: ReferenceFact[] = [];
  const unresolved: UnresolvedFact[] = [];
  const definedNames = new Set<string>();
  const nodesByFile = new Map<string, FactNode[]>();
  const referenceTargets = new Map<string, { toFile: string | null; toNodeId: string }>();
  for (const [file, ir] of Object.entries(env.files)) {
    const resolved = new Set<string>();
    for (const e of ir.edges ?? []) {
      if (e.type !== "reference" || typeof e.source !== "string") continue;
      resolved.add(e.source);
      const q = typeof e.qualifiedTarget === "string" ? e.qualifiedTarget : "";
      const fromQ = q.includes(":") ? q.slice(q.lastIndexOf(":") + 1) : "";
      const seg = String(e.target ?? "").split("/").filter((x) => x.endsWith(".fn")).pop() ?? "";
      const toName = fromQ || (seg ? seg.slice(0, -3) : "");
      if (!toName) continue;
      const toFile = typeof e.targetFile === "string" ? e.targetFile : null;
      references.push({ fromFile: file, fromNodeId: e.source, toFile, toName });
      if (typeof e.target === "string") referenceTargets.set(`${file}:${e.source}`, { toFile, toNodeId: e.target });
    }
    const facts: FactNode[] = [];
    for (const n of ir.nodes ?? []) {
      if (n.type === "function_def" && typeof n.name === "string") definedNames.add(n.name);
      facts.push(toFactNode(n, resolved));
      if (n.type !== "call" || resolved.has(n.id)) continue;
      const label = typeof n.funcName === "string" ? n.funcName : "";
      if (label) unresolved.push({ file, label });
    }
    nodesByFile.set(file, facts);
  }

  // ── thread handles ──
  const threads = new Map<string, ContractInputThread>();
  for (const t of env.threads) if (t.entryPointId) threads.set(t.entryPointId, t);
  const terminalKinds = new Map<string, "dynamic" | "unresolved">();
  for (const t of env.threads) {
    for (const n of t.nodes) {
      if ((n.kind === "dynamic" || n.kind === "unresolved") && n.irNodeId) terminalKinds.set(n.irNodeId, n.kind);
    }
  }

  // ── attribution, from the contracts (computed once, lazily) ──
  let attributions: Map<string, { tool: string; role: string; how: string; via?: string }> | null = null;
  const opts = contractOptsFor(env, stack);
  const attributionIndex = () => {
    if (attributions) return attributions;
    attributions = new Map();
    for (const t of env.threads) {
      let c: ThreadContract;
      try { c = computeThreadContract(t, opts as never); } catch { continue; }
      for (const ex of c.externals) {
        if (!ex.irNodeId || !ex.tool) continue;
        attributions.set(ex.irNodeId, { tool: ex.tool.tool, role: ex.tool.role, how: ex.tool.how, ...(ex.tool.via ? { via: ex.tool.via } : {}) });
      }
    }
    return attributions;
  };

  return {
    references,
    importsByFile: Object.fromEntries(Object.entries(stack.byFile ?? {}).map(([f, tools]) => [f, [...(tools as string[])]])),
    definedNames: [...definedNames],
    unresolved,
    commit,
    ...(input.entryPointId ? { entryPointId: input.entryPointId } : {}),
    ...(input.scopeFiles ? { scopeFiles: input.scopeFiles } : {}),
    nodesByFile: (file) => nodesByFile.get(file) ?? null,
    // The stamped language first; the REGISTRY when a payload predates the
    // stamp. Was a hardcoded `.py` check, which the language audit rightly
    // calls extension routing outside the registry.
    languageOf: (file) => env.files[file]?.language ?? languageForPath(file)?.id ?? null,
    threadOf: (ep) => {
      const t = threads.get(ep);
      if (!t) return null;
      return { seed: t.seed, nodes: t.nodes as never, edges: t.edges as never, filesReached: t.filesReached ?? [] };
    },
    terminalKindOf: (_file, irNodeId) => terminalKinds.get(irNodeId) ?? null,
    attributionOf: (_file, irNodeId) => attributionIndex().get(irNodeId) ?? null,
    referenceTargetOf: (file, irNodeId) => referenceTargets.get(`${file}:${irNodeId}`) ?? null,
    runDelta: () => input.runDelta ?? null,
  };
}
