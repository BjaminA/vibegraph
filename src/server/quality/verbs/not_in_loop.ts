// `not-in-loop` (RUN1.md 3.2): no call attributed to `target` (a name) or
// to a tool with `role` sits inside a loop container reached by the
// thread. Forced by AS-10, fleet c5, the perf-lever kind, M-COMP.
//
// The walk is the thread contract's round-trip walk (thread_contract.ts):
// BFS from each loop container over contains/direct/conditional edges,
// never `flow`, through steps to terminals. Two differences: EVERY
// terminal is looked at (not only effectful ones), and a step whose
// function is named in `except` is opaque (a funnel's body is judged by
// its own loops, not by the loop that calls it once per batch).

import { derivedBy, type CheckDefinition, type CheckResult, type FactThread, type NodeRef, type QualityFacts, type Unverifiable } from "../check_registry.ts";
import { labelSegments, labelTail } from "../ir_walk.ts";

export interface NotInLoopOp { rule: "not-in-loop"; target?: string; role?: string; except?: string[] }

const BY = "quality/verbs/not_in_loop.ts";
const LOOPS = new Set(["for", "while", "comprehension"]);
const TERMINALS = new Set(["external", "dynamic", "unresolved"]);
/** Parse-time effect kinds to the stack role they imply, for a terminal no
 *  attribution rule reached. */
const EFFECT_ROLE: Record<string, string> = { http: "http-client", db: "db", subprocess: "process" };
const ROLES = new Set(["web-framework", "frontend", "http-client", "db", "cache", "queue", "tensor", "data", "cloud", "infra", "process", "remote", "test", "build", "runtime", "unknown"]);

/** Assignment shapes that are a collection written out in the source. */
const LITERAL_COLLECTIONS = new Set(["list", "tuple", "set", "dict"]);
const CONSTANT_NAME = /^[A-Z_][A-Z0-9_]{2,}$/;

/**
 * Why a loop's iteration count comes from the SOURCE rather than the data,
 * or null when it does not.
 *
 * The perf-lever this verb serves is about work that scales with the input:
 * fleet c5's "never one insert per row" is a story about a 2M-row backfill.
 * A loop over a collection the source writes out runs a fixed number of
 * times however much data arrives, so a call inside it is not the
 * repetition the rule forbids.
 *
 * Measured (h2h3, 2026-09-21): all five plain-Claude arms AND the
 * orchestrated run wrote a schema migration looping over a module constant
 * of one or two columns, and the verb reported every one of them violated
 * against a clause about per-row inserts. The census across the fixtures
 * found 28 for-loops — 14 over a variable, 6 over a call result, 4 over a
 * module constant, 2 over an inline literal — and NOT ONE of the six
 * source-bounded ones carries an effectful call. So this narrows the verb
 * without changing a single verdict on the corpus it was calibrated
 * against, which is the only reason it can land without re-calibration.
 *
 * Two shapes qualify, both read from the IR, neither guessed:
 *   `for x in [a, b]`        the iterable IS a literal collection
 *   `for x in ADDED_COLUMNS` a module-level constant bound to one
 * A constant bound to a CALL (`DEVICE_IDS = load_ids()`) does NOT qualify:
 * the source does not say how many. Nor does `for x in items` — a
 * lower-case local is data, by convention and by this rule.
 */
function sourceBounded(
  loop: { irNodeId: string | null; file: string | null },
  seedFile: string,
  facts: QualityFacts,
): string | null {
  if (!loop.irNodeId || !facts.nodesByFile) return null;
  const nodes = facts.nodesByFile(loop.file ?? seedFile);
  if (!nodes) return null;
  const iter = nodes.find((n) => n.id === loop.irNodeId)?.iterName?.trim();
  if (!iter) return null;
  if (/^[[({]/.test(iter)) return `it iterates the literal collection ${iter.slice(0, 48)}`;
  if (!CONSTANT_NAME.test(iter)) return null;
  const bound = nodes.find((n) =>
    n.type === "assignment" && n.name === iter && n.parentId === null
    && LITERAL_COLLECTIONS.has(n.valueKind ?? ""));
  return bound
    ? `it iterates ${iter}, a module constant the source binds to a literal ${bound.valueKind}`
    : null;
}

function isOp(v: unknown): v is NotInLoopOp {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (r.rule !== "not-in-loop") return false;
  if (!Object.keys(r).every((k) => ["rule", "target", "role", "except"].includes(k))) return false;
  const t = r.target === undefined || (typeof r.target === "string" && !!r.target);
  const role = r.role === undefined || (typeof r.role === "string" && ROLES.has(r.role));
  const ex = r.except === undefined || (Array.isArray(r.except) && r.except.every((s) => typeof s === "string" && !!s));
  return t && role && ex && (r.target !== undefined || r.role !== undefined);
}

interface Hit { ref: NodeRef; label: string; loop: string; kind: string; role: string | null; via: string | null }

export const notInLoop: CheckDefinition<NotInLoopOp> = {
  rule: "not-in-loop",
  costClass: "thread",
  forcedBy: ["AS-10", "c5", "VG-3"],
  isOperands: isOp,
  describe: (op) => `no call to ${op.target ? `\`${op.target}\`` : ""}${op.target && op.role ? " / " : ""}${op.role ? `role ${op.role}` : ""} inside a loop on this thread`,
  preconditions(facts, _op): Unverifiable | null {
    const provenance = derivedBy(BY, facts);
    if (!facts.threadOf || !facts.entryPointId) {
      return { verdict: "unverifiable", reason: "no thread in scope: not-in-loop walks one thread's loop containers", cause: "precondition", at: [], offenders: [], provenance };
    }
    if (!facts.threadOf(facts.entryPointId)) {
      return { verdict: "unverifiable", reason: `no thread for entry point ${facts.entryPointId}`, cause: "precondition", at: [], offenders: [], provenance };
    }
    return null;
  },
  evaluate(facts: QualityFacts, op: NotInLoopOp): CheckResult {
    const provenance = derivedBy(BY, facts);
    const thread = facts.threadOf!(facts.entryPointId!)!;
    const except = new Set(op.except ?? []);
    const byId = new Map(thread.nodes.map((n) => [n.id, n]));
    const out = new Map<string, { to: string; irSource: string | null }[]>();
    for (const e of thread.edges) {
      if (e.kind === "flow") continue;
      if (!out.has(e.from)) out.set(e.from, []);
      out.get(e.from)!.push({ to: e.to, irSource: e.irSource });
    }
    const allLoops = thread.nodes.filter((n) => n.kind === "container" && LOOPS.has(n.containerKind ?? ""));
    // A loop the SOURCE bounds is not the repetition this verb is about.
    // Excluded, never silently: every verdict below names what it skipped
    // and why, because a checker that quietly drops what it could not
    // judge is worse than the prose it replaced.
    const bounded: { label: string; why: string }[] = [];
    const loops = allLoops.filter((l) => {
      const why = sourceBounded(l, thread.seed.file, facts);
      if (why) bounded.push({ label: l.label, why });
      return !why;
    });
    const boundedNote = bounded.length
      ? `${bounded.length} loop(s) not counted — the source fixes how often they run: `
        + bounded.map((b) => `\`${b.label}\` (${b.why})`).join("; ")
      : null;
    const hits: Hit[] = [];
    const candidates: { ref: NodeRef; label: string; loop: string; kind: "dynamic" | "unresolved" }[] = [];
    const attributed: string[] = [];
    for (const loop of loops) {
      const seen = new Set<string>([loop.id]);
      const queue: { id: string; file: string; via: string | null }[] = [{ id: loop.id, file: loop.file ?? thread.seed.file, via: null }];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const edge of out.get(cur.id) ?? []) {
          if (seen.has(edge.to)) continue;
          seen.add(edge.to);
          const n = byId.get(edge.to);
          if (!n) continue;
          if (n.kind === "step") {
            const name = n.label.split(".").pop() ?? n.label;
            if (except.has(name)) continue; // a funnel is opaque from outside
            queue.push({ id: n.id, file: n.file ?? cur.file, via: cur.via ?? n.label });
            continue;
          }
          if (!TERMINALS.has(n.kind)) { queue.push({ id: n.id, file: n.file ?? cur.file, via: cur.via }); continue; }
          const file = n.file ?? cur.file;
          // The terminal's OWN call node. A `contains` edge's irSource is
          // the container that contains it, which is not a call site.
          const site = n.irNodeId ?? edge.irSource;
          const ref = `${file}:${site ?? "module"}` as NodeRef;
          const tool = site ? facts.attributionOf?.(file, site) ?? null : null;
          const role = tool?.role ?? (n.effectKind ? EFFECT_ROLE[n.effectKind] ?? null : null);
          const segs = labelSegments(n.label);
          const nameHit = !!op.target && (segs.includes(op.target) || labelTail(n.label) === op.target);
          const roleHit = !!op.role && role === op.role;
          if (nameHit || roleHit) {
            hits.push({ ref, label: n.label, loop: loop.label, kind: n.kind, role, via: cur.via });
            continue;
          }
          if (tool || n.effectKind) attributed.push(`${n.label} (${role ?? tool?.tool ?? n.effectKind})`);
          if (n.kind === "dynamic" || n.kind === "unresolved") {
            // Could it be the target? With a name: the label mentions it.
            // With only a role: any terminal whose effect is unknown.
            const couldBe = op.target ? segs.includes(op.target) : !role;
            if (couldBe) candidates.push({ ref, label: n.label, loop: loop.label, kind: n.kind });
          }
        }
      }
    }
    if (hits.length) {
      const desc = hits.map((h) => `\`${h.label}\` inside \`${h.loop}\`${h.via ? ` via ${h.via}` : ""}${h.role ? ` [${h.role}]` : ""}`);
      return { verdict: "violated", reason: `a call to ${op.target ? `\`${op.target}\`` : `role ${op.role}`} runs once per iteration: ${desc.join("; ")}${boundedNote ? `. ${boundedNote}` : ""}`, offenders: [hits[0].ref, ...hits.slice(1).map((h) => h.ref)], provenance };
    }
    if (candidates.length) {
      const dyn = candidates.filter((c) => c.kind === "dynamic").length;
      const cause = dyn ? "dynamic" : "unresolved";
      return {
        verdict: "unverifiable",
        reason: `no attributed call matched inside ${loops.length} loop(s), but ${candidates.length} ${cause === "dynamic" ? "runtime-dispatched" : "unresolved"} call(s) inside a loop could be it `
          + `(${candidates.map((c) => `\`${c.label}\` in \`${c.loop}\` [${c.kind}]`).join("; ")}). ${cause === "dynamic" ? "Only a trace or a stated attribution can lift this." : "A re-link may lift this."}`
          + `${boundedNote ? ` ${boundedNote}.` : ""}`,
        cause, at: candidates.map((c) => c.ref), offenders: [], provenance,
      };
    }
    const notFollowed: string[] = [
      "generator consumption is not tracked (an unconsumed genexp still counts as a loop)",
      "loop iteration counts are unknown",
      // h2h3: the orchestrated arm guards its per-device read with
      // `if device_id not in prior_regions`, so the call runs once per
      // DISTINCT device, not once per reading. The call is still inside
      // the loop and still reported; the saving is real and invisible here.
      "a condition inside the loop that skips the call on some iterations is not followed: a reported call may run fewer times than the loop iterates",
      ...(op.except?.length ? [`funnel(s) ${op.except.join(", ")} were not entered from outside; their own loops were judged on their own`] : []),
      ...(loops.length ? [] : ["no loop container was reached on this thread: nothing was inside one"]),
      ...(boundedNote ? [boundedNote] : []),
    ];
    return {
      verdict: "pass",
      reason: (loops.length
        ? `${loops.length} loop(s) examined (${loops.map((l) => `\`${l.label}\``).join(", ")}); ${attributed.length ? `attributed calls inside them: ${[...new Set(attributed)].join(", ")}` : "no attributed call inside any of them"}`
        : allLoops.length ? "no data-bounded loop on this thread" : "no loop on this thread")
        + (boundedNote ? `. ${boundedNote}` : ""),
      notFollowed: [notFollowed[0], ...notFollowed.slice(1)],
      offenders: [], provenance,
    };
  },
};

export type { FactThread };
