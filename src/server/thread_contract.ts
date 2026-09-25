// M-CONTRACT.2 (PLAN-M-CONTRACT.md) — the THREAD CONTRACT: what a bounded
// agent must know about a thread's DATA and its SURROUNDINGS to work inside
// it without guessing — derived from the IR, never from prose.
//
//   * interface   — the seed's params / declared return / docstring: what
//                   enters and leaves the thread at its head;
//   * externals   — every external terminal grouped by effectKind (the
//                   backend calls, proxies, files, subprocesses) WITH the
//                   literal call preview, so an agent reads the endpoint /
//                   SQL / path text the code actually uses;
//   * roundTrips  — http/db/subprocess/fs work reachable INSIDE a loop
//                   container, named per loop: the N+1 lever;
//   * crossThread — the tcall adjacency (the handoff surface);
//   * boundaries  — where static knowledge ENDS (gaps/dynamic/uncaptured).
//
// The honesty split holds: everything here is IR FACT. What the IR cannot
// see (which proxy fronts that URL, what schema that payload must keep)
// is a STATED constraint (constraint_store.ts) and is labelled as such.
// Pure: no server state, no LLM, no fs.

import type { Thread, ThreadNode } from "../webview/threads/types";
import type { Crossing } from "./crossings.ts";
import { languageForPath } from "../shared/languages.ts";
import { ROLE_ORDER } from "../shared/stack_taxonomy.ts";
import {
  attributeBoundary, attributionLabel, effectFromRole,
  type Attribution, type ImportBinding, type LocalBinding, type StackLike,
} from "../shared/stack_attribution.ts";

/** Effects that cost a round trip when repeated inside a loop. */
export const ROUND_TRIP_EFFECTS = new Set(["http", "db", "subprocess", "fs"]);
// M-COMP — `comprehension` sits here because a comprehension IS a loop:
// `[fetch(u) for u in urls]` performs exactly the N round trips the
// spelled-out for-loop performs. Until it had a container this detector
// could not see it, so the N+1 finding depended on the author's choice of
// spelling — the kind of inconsistency a verdict must never have.
const LOOP_CONTAINERS = new Set(["for", "while", "comprehension"]);
const TERMINAL_KINDS = new Set(["external", "dynamic", "unresolved"]);
const MAX_LISTED = 24;
/** Per tool group in the boundary section, and for the unattributed line. */
const MAX_PER_GROUP = 8;

export interface ContractExternal {
  id: string;
  kind: "external" | "dynamic" | "unresolved";
  label: string;
  effectKind: string | null;
  preview: string | null;
  irNodeId: string | null;
  qualifiedTarget?: string;
  /** M-BOUNDARY.1 — the tool this boundary leaves the project through.
   *  Absent = the IR resolved no callee, binding, call site or funnel for
   *  it (counted in `boundaries.unattributed`), never a guess. */
  tool?: Attribution;
  /** The effect implied by that tool's ROLE, when the parse found none.
   *  Display only — never written to the IR, never read by the run gate. */
  effectFromRole?: string;
  /** PLAN-M-RUNTIME phase 3 - what a consented trace run SAW here. Beside
   *  the static facts above, never instead of them. */
  observed?: ContractObservation[];
}

export interface ContractRoundTrip {
  loop: string;
  loopLabel: string;
  file: string | null;
  calls: {
    id: string; label: string; effectKind: string; via: string | null;
    tool?: Attribution;
    /** the effect came from the tool's role, not from the parse. */
    fromRole?: true;
  }[];
}

/** M-STACK.1 — one tool this thread's files use. PLAN-M-STACK wrote
 *  `stack: string[]`; the same section asks the contract line to carry
 *  EVIDENCE COUNTS and the wrapper relation, which bare names cannot do.
 *  Routing still takes the names (`stack.map(s => s.tool)`). */
export interface ContractStackEntry {
  tool: string;
  role: string;
  origin: string;
  /** How many parse sites back this tool inside the thread's files. */
  evidence: number;
  /** origin "project": the tools this funnel wraps. */
  wraps?: string[];
}

/** PLAN-M-RUNTIME phase 3 — what a consented run saw at one terminal.
 *  Rides the external so the renderer can put it in its own section without
 *  a second lookup, and so a consumer reading the JSON gets the caveat
 *  (`stale`, `inputs`, which run) attached to the value rather than beside
 *  it. NEVER folded into `tool` or `effectKind`: those are what the source
 *  says, and this is what one execution did. */
export interface ContractObservation {
  callees: Array<{ callee: string; count: number }>;
  entryPointId: string;
  at: string;
  inputs: string;
  stale: boolean;
}

export interface ThreadContract {
  entryPointId: string;
  qualifiedName: string;
  language: string;
  seedFile: string;
  interface: {
    params: string[];
    returns: string | null;
    docstring: string | null;
    /** Return-terminal previews (what the seed hands back), capped. */
    returnPreviews: string[];
  };
  externals: ContractExternal[];
  /** effectKind → count over external terminals. PARSE-TIME only, so the
   *  numbers keep the meaning every existing consumer reads them with. */
  effects: Record<string, number>;
  /** M-BOUNDARY.1 — effects implied by an attributed tool's ROLE where the
   *  parse found none. Counted apart, and labelled wherever rendered. */
  effectsByRole: Record<string, number>;
  roundTrips: ContractRoundTrip[];
  crossThread: { reaches: string[]; reachedBy: string[] };
  filesReached: string[];
  /** M-STACK.1 — the tools this thread's files use, project funnels first.
   *  Empty when no stack index was injected (the pre-M-STACK shape). */
  stack: ContractStackEntry[];
  /** M-BOUNDARY.1 — the tools this thread actually CALLS (a boundary
   *  attributes to them), a subset of `stack`, which is file-level
   *  presence. Project funnels included, builtins never. */
  called: string[];
  /** M-XLANG.1 - HTTP hops that leave this thread's language, each with
   *  the route(s) that serve them. A weighed claim, never a resolved
   *  edge: `filesReached` is untouched, so the thread stays one language.
   *  Empty when no crossing index was injected. */
  crossings: Crossing[];
  boundaries: {
    resolutionGaps: number; runtimeDispatch: number; uncaptured: number;
    /** M-BOUNDARY.1 — boundaries no attribution rule reached. */
    unattributed: number;
    /** language builtins skipped as not-a-boundary (`len`, `Error`). */
    builtins: number;
    /** M-RESOLVE - calls on a LOCAL literal (`problems.push` where
     *  `problems = []`). Local data work, resolved statically and for
     *  free; a third of what used to be counted as unknown. */
    localData: number;
  };
  notes: string[];
}

export interface ContractInputThread extends Thread {
  entryPointId?: string | null;
  filesReached?: string[];
}

export interface ThreadContractOpts {
  /** Per-file IR lookup by (file, irNodeId); file null = search every file. */
  nodeFor: (file: string | null, irNodeId: string | null) => Record<string, unknown> | null;
  reaches: string[];
  reachedBy: string[];
  /** M-STACK.1 — the stack facts for one file (project funnels first).
   *  Injected so the contract stays PURE over the IR; absent = no index. */
  stackFor?: (file: string) => ContractStackEntry[];
  // ── M-BOUNDARY.1 — what boundary attribution needs, injected the same
  // way `stackFor` is, so this module keeps its purity. All three absent =
  // the pre-M-BOUNDARY shape: every boundary comes back unattributed.
  /** Which FILE owns a call node. External terminals carry `file: null`
   *  (the extractor's shape), so the owning file has to be looked up. */
  fileOfNode?: (irNodeId: string) => string | null;
  /** One file's import bindings (`shared/stack_attribution.importBindings`). */
  importsFor?: (file: string) => ImportBinding[];
  /** M-RESOLVE - one file's LOCAL bindings, so a receiver bound three
   *  lines up resolves without a run. */
  localsFor?: (file: string) => LocalBinding[];
  /** M-RESOLVE.3 - the route handler enclosing a call node, if any: the
   *  framework its entry point recorded and the handler's parameters.
   *  Injected because entry points live outside this module. */
  handlerFor?: (file: string, irNodeId: string) => { framework?: string | null; params?: string[] } | null;
  /** The stack index itself: funnel homes and bash call-site evidence. */
  stackIndex?: StackLike | null;
  /** M-XLANG.1 - this thread's crossings (src/server/crossings.ts).
   *  Injected like `stackFor`, so the contract stays pure over the IR. */
  crossingsFor?: (entryPointId: string) => Crossing[];
  /** PLAN-M-RUNTIME phase 3 - what a consented TRACE RUN saw at a node.
   *  Injected like everything else here, so the contract stays pure. Absent
   *  = no overlay, and the contract reads exactly as it did before phase 3.
   *
   *  This is the one input to a contract that is NOT derived from source: a
   *  human authorised a run and this is what happened. It is rendered in its
   *  own section, never folded into the IR facts above it. */
  observedFor?: (file: string | null, irNodeId: string | null) => Array<{
    callees: Array<{ callee: string; count: number }>;
    entryPointId: string;
    at: string;
    inputs: string;
    stale: boolean;
  }>;
}

/** M-RESOLVE - attributions that are NOT boundaries: a language builtin,
 *  and a method on a local literal (`problems = []` then `problems.push`
 *  is list work). Keeping them out of the boundary list is what makes
 *  that list mean something. */
function notABoundary(a: Attribution | undefined): boolean {
  return !!a && (a.how === "builtin" || a.how === "local-literal");
}

/** Deterministic order wherever attributed tools are listed: project
 *  funnels first (how this thread reaches out), then by role, then name. */
function compareAttribution(a: Attribution, b: Attribution): number {
  const oa = a.origin === "project" ? 0 : 1;
  const ob = b.origin === "project" ? 0 : 1;
  if (oa !== ob) return oa - ob;
  const rank = (r: string): number => {
    const i = (ROLE_ORDER as readonly string[]).indexOf(r);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  const ra = rank(a.role);
  const rb = rank(b.role);
  if (ra !== rb) return ra - rb;
  return a.tool.localeCompare(b.tool);
}

function effectOf(n: ThreadNode, nodeFor: ThreadContractOpts["nodeFor"]): string | null {
  if (typeof n.effectKind === "string") return n.effectKind;
  const ir = n.irNodeId ? nodeFor(n.file, n.irNodeId) : null;
  return ir && typeof ir.effectKind === "string" ? ir.effectKind : null;
}

/** The literal call text. A statement-level call's thread preview is just
 *  its callee name (the extractor falls back to funcName), so rebuild it
 *  from the IR node's funcName + args — the endpoint / SQL / path an agent
 *  must see. Assignment-valued calls already carry a real preview. */
function previewOf(n: ThreadNode, nodeFor: ThreadContractOpts["nodeFor"]): string | null {
  if (n.preview && n.preview !== n.label) return n.preview;
  const ir = n.irNodeId ? nodeFor(n.file, n.irNodeId) : null;
  if (!ir) return n.preview ?? null;
  if (typeof ir.preview === "string" && ir.preview) return ir.preview;
  if (typeof ir.funcName === "string" && Array.isArray(ir.args)) {
    return `${ir.funcName}(${(ir.args as unknown[]).filter((a) => typeof a === "string").join(", ")})`;
  }
  return n.preview ?? null;
}

/** M-FLOW.2 — one crossing's head, by kind: `GET /ingest`, `runs
 *  \`orders/export.sh\``, `tool list_orders`. */
export function crossingHead(x: Crossing): string {
  if (x.kind === "command") return `runs \`${x.path}\``;
  if (x.kind === "tool") return `tool ${x.path}`;
  return `${x.method ?? "?"} ${x.path}`;
}

export function computeThreadContract(thread: ContractInputThread, opts: ThreadContractOpts): ThreadContract {
  const lang = languageForPath(thread.seed.file);
  const seedIr = opts.nodeFor(thread.seed.file, thread.seed.irNodeId) ?? {};
  const rawParams = Array.isArray(seedIr.params) ? (seedIr.params as unknown[]).filter((p): p is string => typeof p === "string") : [];
  // M-CONTRACT (2026-09-07) — Python's IR keeps `params` as name /
  // name=default and carries annotations in `paramTypes` (additive);
  // render `name: type` so "data in" reads like a TS/C++ thread's, and
  // NAME the params that stay unannotated instead of a blanket note.
  const paramTypes = (seedIr.paramTypes && typeof seedIr.paramTypes === "object")
    ? (seedIr.paramTypes as Record<string, unknown>) : {};
  const untyped: string[] = [];
  const params = rawParams.map((p) => {
    const name = p.split("=", 1)[0];
    const type = paramTypes[name];
    if (typeof type === "string") return p.includes("=") ? `${name}: ${type}${p.slice(name.length)}` : `${name}: ${type}`;
    if (lang?.id === "python" && !/[:*]/.test(p) && !["self", "cls"].includes(name)) untyped.push(name);
    return p;
  });
  const returns = typeof seedIr.returns === "string" ? seedIr.returns : null;
  const docstring = typeof seedIr.docstring === "string" ? seedIr.docstring : null;

  const byId = new Map(thread.nodes.map((n) => [n.id, n]));
  const externals: ContractExternal[] = [];
  const effects: Record<string, number> = {};
  const effectsByRole: Record<string, number> = {};
  const boundaries = { resolutionGaps: 0, runtimeDispatch: 0, uncaptured: 0, unattributed: 0, builtins: 0, localData: 0 };
  const returnPreviews: string[] = [];

  // M-BOUNDARY.1 — one attribution per terminal, memoised: the externals
  // list and the round-trip BFS must agree about what a call reaches (a
  // commit inside a loop is a round trip because the funnel it lives in is
  // a db funnel, and both readers have to see the same fact).
  const attributions = new Map<string, Attribution | null>();
  const attributeOf = (n: ThreadNode): Attribution | null => {
    const cached = attributions.get(n.id);
    if (cached !== undefined) return cached;
    const file = n.file ?? (n.irNodeId ? opts.fileOfNode?.(n.irNodeId) ?? null : null);
    const a = attributeBoundary({
      language: (file ? languageForPath(file)?.id : null) ?? lang?.id ?? "unknown",
      label: n.label,
      kind: n.kind as ContractExternal["kind"],
      qualifiedTarget: n.qualifiedTarget ?? null,
      effectKind: effectOf(n, opts.nodeFor),
      file,
      irNodeId: n.irNodeId,
      imports: file ? opts.importsFor?.(file) ?? [] : [],
      locals: file ? opts.localsFor?.(file) ?? [] : [],
      handler: file && n.irNodeId ? opts.handlerFor?.(file, n.irNodeId) ?? null : null,
      stack: opts.stackIndex ?? null,
    });
    attributions.set(n.id, a);
    return a;
  };
  /** The effect a call costs: what the parse proved, else what the tool's
   *  role implies. `fromRole` keeps the two tellable apart everywhere. */
  const effectiveEffect = (n: ThreadNode): { ek: string | null; fromRole: boolean } => {
    const parsed = effectOf(n, opts.nodeFor);
    if (parsed) return { ek: parsed, fromRole: false };
    const role = effectFromRole(attributeOf(n));
    return role ? { ek: role, fromRole: true } : { ek: null, fromRole: false };
  };

  for (const n of thread.nodes) {
    if (n.kind === "unresolved") boundaries.resolutionGaps++;
    if (n.kind === "dynamic") boundaries.runtimeDispatch++;
    if (n.nestsInnerCalls && !n.nestExtracted) boundaries.uncaptured++;
    if (n.kind === "return" && n.id.startsWith(thread.seed.file.replace(/\.[^.]+$/, ""))) {
      if (n.preview && returnPreviews.length < 3) returnPreviews.push(n.preview);
    }
    if (!TERMINAL_KINDS.has(n.kind)) continue;
    const ek = effectOf(n, opts.nodeFor);
    if (ek) effects[ek] = (effects[ek] ?? 0) + 1;
    const tool = attributeOf(n);
    const roleEffect = ek ? null : effectFromRole(tool);
    if (roleEffect) effectsByRole[roleEffect] = (effectsByRole[roleEffect] ?? 0) + 1;
    if (!tool) boundaries.unattributed++;
    else if (tool.how === "local-literal") boundaries.localData++;
    else if (tool.how === "builtin") boundaries.builtins++;
    const observed = opts.observedFor?.(
      n.file ?? opts.fileOfNode?.(n.irNodeId ?? "") ?? null, n.irNodeId,
    ) ?? [];
    externals.push({
      id: n.id, kind: n.kind as ContractExternal["kind"], label: n.label,
      effectKind: ek, preview: previewOf(n, opts.nodeFor), irNodeId: n.irNodeId,
      ...(n.qualifiedTarget ? { qualifiedTarget: n.qualifiedTarget } : {}),
      ...(tool ? { tool } : {}),
      ...(roleEffect ? { effectFromRole: roleEffect } : {}),
      ...(observed.length ? { observed } : {}),
    });
  }
  // The tools this thread actually CALLS — index order is not available
  // here, so: project funnels first (they are the answer to "how does this
  // thread reach out"), then by role, then by name.
  const calledTools = new Map<string, Attribution>();
  for (const e of externals) {
    // A builtin is not a tool; project code the linker missed is a
    // resolution gap, not a tool the thread chose.
    if (!e.tool || notABoundary(e.tool) || e.tool.projectModule) continue;
    // `called` is a subset of `stack`, so it may only name tools the
    // INDEX knows. The language's own runtime (`shell`, `builtins`) is
    // not a tool this project chose, and naming one here would leave a
    // dangling reference for anything that joins the two lists.
    if (opts.stackIndex && !opts.stackIndex.tools.some((t) => t.tool === e.tool!.tool)) continue;
    if (!calledTools.has(e.tool.tool)) calledTools.set(e.tool.tool, e.tool);
    // A call attributed THROUGH a funnel means both are reached.
    if (e.tool.via && !calledTools.has(e.tool.via)) {
      calledTools.set(e.tool.via, { ...e.tool, tool: e.tool.via, role: e.tool.role, origin: "project" });
    }
  }
  const called = [...calledTools.values()].sort(compareAttribution).map((t) => t.tool);

  // Round trips: BFS from each loop container over contains/direct/
  // conditional edges (never `flow` joins), through steps, collecting
  // effectful terminals — "inside this loop the thread reaches N calls
  // that each cost a round trip (via step X)".
  const out = new Map<string, { to: string; kind: string }[]>();
  for (const e of thread.edges) {
    if (e.kind === "flow") continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push({ to: e.to, kind: e.kind });
  }
  const roundTrips: ContractRoundTrip[] = [];
  for (const loop of thread.nodes) {
    if (loop.kind !== "container" || !LOOP_CONTAINERS.has(loop.containerKind ?? "")) continue;
    const seen = new Set<string>([loop.id]);
    const queue: { id: string; via: string | null }[] = [{ id: loop.id, via: null }];
    const calls: ContractRoundTrip["calls"] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const edge of out.get(cur.id) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        const n = byId.get(edge.to);
        if (!n) continue;
        const via = n.kind === "step" ? (cur.via ?? n.label) : cur.via;
        if (TERMINAL_KINDS.has(n.kind)) {
          // M-BOUNDARY.1 — a call with no parse-time effect still costs a
          // round trip when the tool it goes through says so: `conn.commit()`
          // inside a loop is N commits, and the IR only learned that once
          // the boundary was attributed to sqlite3 (via the db funnel).
          const { ek, fromRole } = effectiveEffect(n);
          if (ek && ROUND_TRIP_EFFECTS.has(ek)) {
            const tool = attributeOf(n);
            calls.push({
              id: n.id, label: n.label, effectKind: ek, via: cur.via,
              ...(tool ? { tool } : {}), ...(fromRole ? { fromRole: true as const } : {}),
            });
          }
        }
        queue.push({ id: n.id, via });
      }
    }
    if (calls.length) roundTrips.push({ loop: loop.id, loopLabel: loop.label, file: loop.file, calls });
  }

  const notes: string[] = [];
  if (untyped.length) {
    notes.push(`Unannotated Python params (no type in the source signature — the IR carries every annotation that exists): ${untyped.join(", ")}.`);
  }
  if (boundaries.uncaptured) notes.push("uncaptured: a statement hides calls the parser did not decompose — the externals list is incomplete there.");
  if (boundaries.resolutionGaps) notes.push("resolution gaps are calls the linker could not resolve — they may be project code the contract cannot see.");

  // M-STACK.1 — the tools this thread's files use. Deduped by tool name,
  // encounter order preserved (the index hands back project funnels first),
  // evidence counts summed across the thread's files.
  const filesReached = thread.filesReached ?? [thread.seed.file];
  const stack: ContractStackEntry[] = [];
  if (opts.stackFor) {
    const seen = new Map<string, ContractStackEntry>();
    for (const f of filesReached) {
      for (const e of opts.stackFor(f)) {
        const prior = seen.get(e.tool);
        if (prior) { prior.evidence += e.evidence; continue; }
        const copy: ContractStackEntry = { ...e, ...(e.wraps ? { wraps: [...e.wraps] } : {}) };
        seen.set(e.tool, copy);
        stack.push(copy);
      }
    }
  }

  return {
    entryPointId: thread.entryPointId ?? `${thread.seed.file}:${thread.seed.qualifiedName.split(":").pop()}`,
    qualifiedName: thread.seed.qualifiedName,
    language: lang?.id ?? "unknown",
    seedFile: thread.seed.file,
    interface: { params, returns, docstring, returnPreviews },
    externals,
    effects,
    effectsByRole,
    roundTrips,
    crossThread: { reaches: [...opts.reaches].sort(), reachedBy: [...opts.reachedBy].sort() },
    filesReached,
    stack,
    called,
    crossings: opts.crossingsFor?.(thread.entryPointId ?? "") ?? [],
    boundaries,
    notes,
  };
}

/** Compact one-line summary for plan packets / orchestrator briefs. */
export function summarizeContract(c: ThreadContract): {
  params: number; returns: string | null; effects: Record<string, number>; roundTrips: number;
  /** M-STACK.1 — the tool NAMES (project funnels first): what a packet
   *  annotation and a stack-scoped constraint route on. */
  stack: string[];
  /** M-BOUNDARY.1 — the subset of `stack` a boundary actually reaches.
   *  `stack` is presence in the thread's files; this is use. */
  called: string[];
  /** M-XLANG.1 - the entry points this thread's HTTP hops land on, in
   *  another language. An ambiguous hop contributes every candidate. */
  crossesInto: string[];
  /** RUN1 4.2 — boundaries no attribution rule reached, so the review can
   *  say whether an edit added one (no-new-unattributed-boundary). */
  unattributed: number;
} {
  return {
    params: c.interface.params.length, returns: c.interface.returns,
    effects: c.effects, roundTrips: c.roundTrips.length,
    stack: c.stack.map((s) => s.tool),
    called: [...c.called],
    crossesInto: [...new Set(c.crossings.flatMap((x) => x.targets.map((t) => t.entryPointId)))].sort(),
    unattributed: c.boundaries.unattributed,
  };
}

/** A preview is source text and may carry newlines (a multi-line `fetch`
 *  call). One boundary is one line, so flatten it. */
function oneLine(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * M-BOUNDARY.1 — every boundary grouped by the TOOL it leaves through,
 * then the ones no rule reached, then the builtins that are not boundaries
 * at all. Exhaustive by construction: each external lands in exactly one
 * of the three, so nothing can quietly vanish the way effect-less db calls
 * did before this milestone.
 */
function boundarySection(c: ThreadContract): string[] {
  if (!c.externals.length) return [];
  const groups = new Map<string, { at: Attribution; items: ContractExternal[] }>();
  const unattributed: ContractExternal[] = [];
  const builtins: string[] = [];
  const localData: ContractExternal[] = [];
  for (const e of c.externals) {
    if (!e.tool) { unattributed.push(e); continue; }
    if (e.tool.how === "local-literal") { localData.push(e); continue; }
    if (e.tool.how === "builtin") {
      if (!builtins.includes(e.tool.tool)) builtins.push(e.tool.tool);
      continue;
    }
    const key = `${e.tool.tool}|${e.tool.via ?? ""}`;
    const g = groups.get(key);
    if (g) g.items.push(e);
    else groups.set(key, { at: e.tool, items: [e] });
  }

  /** dedupe identical call texts into `×N`, cap, and say what was cut. */
  const render = (texts: string[]): string => {
    const seen = new Map<string, number>();
    for (const t of texts) seen.set(t, (seen.get(t) ?? 0) + 1);
    const shown = [...seen].slice(0, MAX_PER_GROUP).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t));
    const cut = seen.size - shown.length;
    return `${shown.join("; ")}${cut > 0 ? `; +${cut} more` : ""}`;
  };

  const out: string[] = [];
  if (groups.size) {
    out.push("", "Leaves the project through (boundaries by tool — IR fact; `via` = the project funnel the call lives in):");
    for (const g of [...groups.values()].sort((a, b) => compareAttribution(a.at, b.at))) {
      const texts = g.items.map((e) => {
        const text = oneLine(e.preview && e.preview !== e.label ? e.preview : `${e.label}(…)`);
        const ek = e.effectKind
          ? ` [${e.effectKind}]`
          : e.effectFromRole ? ` [${e.effectFromRole}, by tool role]` : "";
        return `${text}${ek}`;
      });
      const head = attributionLabel(g.at) + (g.at.calleeUnresolved ? " — callee unresolved" : "");
      out.push(`- ${head}: ${render(texts)}`);
    }
  }
  if (unattributed.length) {
    const texts = unattributed.map((e) => `${oneLine(e.label, 60)} [${e.kind}${e.effectKind ? `, ${e.effectKind}` : ""}]`);
    out.push(`Not attributed to a tool (no callee, binding, call site or funnel resolved — ${unattributed.length} of ${c.externals.length}): ${render(texts)}`);
  }
  if (localData.length) {
    // M-RESOLVE - these used to be counted as unknown receivers. They are
    // local data work, and saying so is what keeps the boundary list above
    // meaningful.
    const texts = localData.map((e) => `${oneLine(e.label, 40)} [${e.tool!.tool}]`);
    out.push(`Local data operations (not boundaries - the receiver is a literal in this file): ${render(texts)}`);
  }
  if (builtins.length) {
    out.push(`Language builtins (not boundaries): ${[...builtins].sort().join(", ")}`);
  }
  return out;
}

/** Render the contract as a deterministic markdown block for prompts —
 *  IR FACT, labelled as such, never LLM-authored. */
export function formatContractBlock(c: ThreadContract): string {
  const lines = ["## Thread contract (IR fact — auto-generated, do not edit)"];
  const langLabel = languageForPath(c.seedFile)?.label ?? c.language;
  lines.push(`Seed: ${c.qualifiedName} (${langLabel}, ${c.seedFile}); files reached: ${c.filesReached.join(", ") || "(none)"}`);
  lines.push(`Enters: ${c.interface.params.length ? c.interface.params.join(", ") : "(no parameters)"}`);
  const leaves = c.interface.returns ? `declared return ${c.interface.returns}` : "no declared return type";
  lines.push(`Leaves: ${leaves}${c.interface.returnPreviews.length ? `; returns ${c.interface.returnPreviews.map((p) => `\`${p}\``).join(", ")}` : ""}`);
  if (c.interface.docstring) lines.push(`Doc: ${c.interface.docstring.split("\n")[0]}`);

  // M-BOUNDARY.1 — an effect the tool's ROLE implies counts here too, and
  // says so. Before it, a db call the parser gave no effectKind (every
  // `conn.execute` behind a resolved receiver) appeared in NO section at
  // all: not effectful, not a non-external kind. That silence is the bug
  // this milestone exists to end.
  const effectOfExternal = (e: ContractExternal): string | null => e.effectKind ?? e.effectFromRole ?? null;
  const effectful = c.externals.filter((e) => effectOfExternal(e));
  if (effectful.length) {
    lines.push("", "Touches (external calls, by effect — the literal call text is what the code uses):");
    const byEffect = new Map<string, ContractExternal[]>();
    for (const e of effectful) {
      const ek = effectOfExternal(e)!;
      if (!byEffect.has(ek)) byEffect.set(ek, []);
      byEffect.get(ek)!.push(e);
    }
    let listed = 0;
    for (const [ek, list] of [...byEffect].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const e of list) {
        if (listed++ >= MAX_LISTED) break;
        const tag = e.effectKind ? ek : `${ek}, by tool role`;
        const through = e.tool && e.tool.how !== "builtin" ? ` → ${attributionLabel(e.tool)}` : "";
        lines.push(`- [${tag}] ${e.label}${e.preview && e.preview !== e.label ? `: ${e.preview}` : ""}${through} \`${e.id}\``);
      }
    }
    if (effectful.length > MAX_LISTED) lines.push(`- [${effectful.length - MAX_LISTED} more effectful calls not listed]`);
  } else {
    // M-BOUNDARY.1 — "pure" is only true of the EFFECTS the parser proved.
    // A thread whose one outbound call sits behind an unresolved receiver
    // used to stop at this line and read as pure; point at the boundary
    // list, which knows better.
    const boundaryCount = c.externals.filter((e) => e.tool && !notABoundary(e.tool)).length;
    lines.push("", boundaryCount
      ? `Touches: no effectful external calls the parser could prove — but ${boundaryCount} boundary/boundaries leave the project (listed below).`
      : "Touches: no effectful external calls on this thread (pure as far as the IR sees).");
  }
  const other = c.externals.filter((e) => !effectOfExternal(e) && e.kind !== "external");
  if (other.length) {
    lines.push(`Untraceable hops: ${other.map((e) => `${e.label} [${e.kind}]`).join(", ")}`);
  }
  lines.push(...boundarySection(c));

  if (c.roundTrips.length) {
    lines.push("", "Round trips inside loops (each iteration pays these — the lever to pull is batching, not micro-optimising):");
    for (const rt of c.roundTrips) {
      const calls = rt.calls.map((k) =>
        `${k.label} [${k.effectKind}${k.fromRole ? ", by tool role" : ""}]${k.via ? ` via ${k.via}` : ""}`
        + `${k.tool && k.tool.how !== "builtin" ? ` → ${attributionLabel(k.tool)}` : ""}`).join("; ");
      lines.push(`- \`${rt.loop}\` (${rt.loopLabel}): ${calls}`);
    }
  } else {
    lines.push("", "Round trips inside loops: none found.");
  }

  // M-STACK.1 — the software tools this thread's files use, with the
  // evidence count behind each. IR FACT, like everything else here: a
  // policy ABOUT a tool is a stated constraint and renders separately.
  if (c.stack.length) {
    const ORIGIN_NOTE: Record<string, string> = {
      project: ", project funnel", stdlib: ", stdlib", unknown: ", origin unknown",
    };
    const render = (s: ContractStackEntry) =>
      `${s.tool} [${s.role}${ORIGIN_NOTE[s.origin] ?? ""}`
      + `${s.wraps?.length ? ` wrapping ${s.wraps.join(", ")}` : ""}, ${s.evidence} site${s.evidence === 1 ? "" : "s"}]`;
    lines.push("", `Stack (tools this thread's files use — IR fact, project funnels first): ${c.stack.map(render).join("; ")}`);
  }

  // PLAN-M-RUNTIME phase 3 — what a RUN saw, in its own section, after every
  // static fact and clearly labelled as a different kind of thing. A reader
  // (human or model) must be able to tell "the source says" from "one
  // execution did", because only the first is true of every execution.
  const observedRows = c.externals.filter((e) => e.observed?.length);
  if (observedRows.length) {
    lines.push("",
      "Observed at runtime (NOT static fact — one consented run, these inputs; "
      + "a branch that did not execute is absent, and a different input may dispatch elsewhere. "
      + "These nodes are still `dynamic`/`unresolved` in the IR):");
    for (const e of observedRows) {
      for (const o of e.observed ?? []) {
        const targets = o.callees
          .map((x) => x.callee + (x.count > 1 ? ` ×${x.count}` : ""))
          .join(", ");
        lines.push(
          `- ${e.label} → ${targets}`
          + ` [run ${o.at.slice(0, 10)} via ${o.entryPointId}; ${o.inputs}`
          + `${o.stale ? "; STALE — the file has changed since this run" : ""}]`,
        );
      }
    }
  }

  // M-XLANG.1 - where the thread leaves its own language. Rendered next to
  // the same-language adjacency so the two read as a pair: one is a call
  // this project can follow, the other is a hop it can only weigh.
  if (c.crossings.length) {
    lines.push("", "Crosses into (hops that leave this thread's language or process — HTTP to a route, a command to a script, a tool call to its registration; a weighed claim, never a resolved edge; this thread's own files stay one language):");
    for (const x of c.crossings) {
      const head = crossingHead(x);
      if (!x.targets.length) {
        const what = x.kind === "command" ? "is that script" : x.kind === "tool" ? "registers that tool" : "serves it";
        lines.push(`- ${head} -> nothing in this project ${what} (${x.callee} in ${x.file})`);
        lines.push(`  what this match could not establish: ${x.note}`);
        continue;
      }
      const targets = x.targets
        .map((t) => `${t.entryPointId} [${t.method}${t.methodAssumed ? " assumed" : ""}${t.framework ? `, ${t.framework}` : ""}]`)
        .join(" OR ");
      lines.push(`- ${head} -> ${x.confidence === "ambiguous" ? `AMBIGUOUS: ${targets}` : targets} (${x.confidence})`);
      lines.push(`  what this match could not establish: ${x.note}`);
    }
  }

  lines.push("", `Cross-thread: reaches ${c.crossThread.reaches.join(", ") || "(none)"}; reached by ${c.crossThread.reachedBy.join(", ") || "(none)"}`);
  const b = c.boundaries;
  lines.push(`Where static knowledge ends: ${b.resolutionGaps} resolution gap(s), ${b.runtimeDispatch} runtime dispatch, ${b.uncaptured} uncaptured, ${b.unattributed} boundary/boundaries with no tool`);
  for (const n of c.notes) lines.push(`Note: ${n}`);
  return lines.join("\n");
}
