// THE PLAN against the code (2026-09-30). One deterministic pass, zero tokens,
// that turns a plan from a document that goes stale into a spec the code is
// measured against. Each live item gets a verdict:
//
//   realised    the code has it
//   drifted     the code has something, and it differs (the detail says how)
//   not-built   nothing in the code yet
//   unanchored  the plan gives nothing to look for (a process with no `at`
//               and no directory of its name)
//   unverified  both ends of a boundary exist; the hop itself is not checked
//   pass / violated / unverifiable / prose   a planned rule, run through the
//               SAME checkers `check` uses — as advice: it gates nothing
//
// Matching is by name and path, and says so. What it cannot see is listed in
// `limits` on every result, never implied away.

import type { Plan, PlanFinding, PlanReconcile, PlanVerdict, PlanProcess } from "../shared/plan_types.ts";
import type { StackIndex } from "./stack.ts";
import { buildQualityFacts } from "./quality/facts.ts";
import { checkConstraint, isConstraintCheck } from "./constraint_grammar.ts";
import { newRegistry, isRun1Check } from "./quality/verbs/index.ts";
import { statedScopeFiles } from "./constraint_store.ts";

export const PLAN_RECONCILE_LIMITS = [
  "matching is by name and path: a planned thread matches an entry point whose label or name reads the same; a step matches a node on that thread whose label contains it",
  "the ORDER of a thread's steps is not compared, only their presence",
  "a boundary's payload keys (`carries`) are not compared against the code",
  "a process→process boundary is `unverified` even when both ends are built: the hop between them is not followed",
  "a planned rule's verdict is advice; only a promoted rule (in constraints.json) is checked by `check` and the hooks",
];

interface EnvLike {
  files: Record<string, any>;
  entryPoints: Array<{ id: string; label?: string; qualifiedName?: string; kind?: string; metadata?: Record<string, unknown> }>;
  threads: Array<{ entryPointId: string | null; nodes: any[]; filesReached?: string[] }>;
}

const norm = (s: string) => s.toLowerCase().replace(/<([^>]+)>|\{([^}]+)\}|\[([^\]]+)\]/g, (_m, a, b, c) => `:${a ?? b ?? c}`).replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
const slug = (s: string) => s.toLowerCase().replace(/[-_ ]+/g, "");

function underPrefix(file: string, at: string): boolean {
  const a = at.replace(/^\.\//, "");
  return file === a || file.startsWith(a.endsWith("/") ? a : `${a}/`);
}

/** The parsed files a planned process owns: its `at` prefix, or a directory
 *  of its name. `null` = nothing to look for. */
export function processFiles(p: PlanProcess, files: string[]): { files: string[]; how: string } | null {
  if (p.at) return { files: files.filter((f) => underPrefix(f, p.at!)), how: `under ${p.at}` };
  const want = new Set([slug(p.id), slug(p.label)]);
  const dirs = new Set<string>();
  for (const f of files) for (const seg of f.split("/").slice(0, -1)) if (want.has(slug(seg))) dirs.add(f.slice(0, f.indexOf(seg) + seg.length));
  if (!dirs.size) return null;
  const found = files.filter((f) => [...dirs].some((d) => underPrefix(f, d)));
  return { files: found, how: `in a directory named like it (${[...dirs].join(", ")})` };
}

export function reconcilePlan(plan: Plan, env: EnvLike, stack: StackIndex, root: string, commit = "plan"): PlanReconcile {
  const findings: PlanFinding[] = [];
  const add = (f: PlanFinding) => findings.push(f);
  const files = Object.keys(env.files);
  const live = <T extends { status?: string }>(xs: T[]) => xs.filter((x) => x.status !== "dropped");

  // ── processes ──
  const owned = new Map<string, string[] | null>();
  for (const p of live(plan.processes)) {
    const m = processFiles(p, files);
    owned.set(p.id, m?.files ?? null);
    if (!m) add({ section: "processes", id: p.id, verdict: "unanchored", detail: "no `at` and no directory of its name — add `at` (where its code will live) to check it" });
    else if (!m.files.length) add({ section: "processes", id: p.id, verdict: "not-built", detail: `no parsed file ${m.how}` });
    else {
      const eps = env.entryPoints.filter((e) => m.files.some((f) => e.id.startsWith(`${f}:`)));
      add({ section: "processes", id: p.id, verdict: "realised", detail: `${m.files.length} file(s) ${m.how}${eps.length ? `, ${eps.length} entry point(s)` : ", no entry point yet"}` });
    }
  }

  // ── stack ──
  const realTools = stack.tools.filter((t) => t.origin !== "project");
  const toolByName = new Map(realTools.map((t) => [t.tool.toLowerCase(), t]));
  for (const t of live(plan.stack)) {
    const real = toolByName.get(t.tool.toLowerCase());
    if (real) {
      add(real.role === t.role
        ? { section: "stack", id: t.tool, verdict: "realised", detail: `used in ${real.files.length} file(s)` }
        : { section: "stack", id: t.tool, verdict: "drifted", detail: `planned as ${t.role}; the code reads it as ${real.role}` });
    } else {
      const same = realTools.filter((r) => r.role === t.role).map((r) => r.tool);
      add(same.length
        ? { section: "stack", id: t.tool, verdict: "drifted", detail: `not used; for ${t.role} the code uses ${same.slice(0, 4).join(", ")}` }
        : { section: "stack", id: t.tool, verdict: "not-built", detail: "not imported or called anywhere yet" });
    }
  }

  // ── boundaries ──
  const plannedTools = new Map(plan.stack.map((t) => [t.tool, t]));
  const boundaryVerdict = new Map<string, PlanVerdict>();
  for (const b of live(plan.boundaries)) {
    const fromFiles = owned.get(b.from);
    const toIsProcess = plan.processes.some((p) => p.id === b.to);
    let f: PlanFinding;
    if (toIsProcess) {
      const toFiles = owned.get(b.to);
      const built = (x: string[] | null | undefined) => !!x && x.length > 0;
      f = built(fromFiles) && built(toFiles)
        ? { section: "boundaries", id: b.id, verdict: "unverified", detail: `${b.from} and ${b.to} are both built; the hop between them is not followed` }
        : { section: "boundaries", id: b.id, verdict: "not-built", detail: `${[b.from, b.to].filter((x) => !built(owned.get(x))).join(" and ")} not built yet` };
    } else {
      const real = toolByName.get(b.to.toLowerCase());
      if (!real) f = { section: "boundaries", id: b.id, verdict: "not-built", detail: `${b.to} is not used anywhere yet${plannedTools.has(b.to) ? "" : " (and it is not a planned tool)"}` };
      else if (!fromFiles) f = { section: "boundaries", id: b.id, verdict: "unverified", detail: `${b.to} is used, but ${b.from} has no location to check it from` };
      else {
        const from = new Set(fromFiles);
        const hits = real.files.filter((x) => from.has(x));
        f = hits.length
          ? { section: "boundaries", id: b.id, verdict: "realised", detail: `${b.from} reaches ${b.to} in ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ", …" : ""}` }
          : { section: "boundaries", id: b.id, verdict: "drifted", detail: `${b.to} is used, but not from ${b.from}'s files (${real.files.slice(0, 3).join(", ")})` };
      }
    }
    boundaryVerdict.set(b.id, f.verdict);
    add(f);
  }

  // ── threads ──
  for (const t of live(plan.threads)) {
    const want = norm(t.id);
    const readsAs = (e: EnvLike["entryPoints"][number]) => {
      const m = e.metadata ?? {};
      const route = typeof m.route === "string" ? m.route : typeof m.path === "string" ? m.path : null;
      const method = typeof m.method === "string" ? m.method : null;
      return [e.label, e.qualifiedName, e.id, e.id.split(":").pop(), route, route && method ? `${method} ${route}` : null];
    };
    const ep = env.entryPoints.find((e) => readsAs(e).some((x) => x && norm(x) === want));
    if (!ep) { add({ section: "threads", id: t.id, verdict: "not-built", detail: "no entry point reads like it yet" }); continue; }
    const thread = env.threads.find((x) => x.entryPointId === ep.id);
    const labels = (thread?.nodes ?? []).map((n: any) => String(n.label ?? "").toLowerCase());
    // A step's own name forms, from its id: `module/Writer.class/write.fn` is
    // also `Writer.write` — the spelling a plan uses for a method, which the
    // label (`write`) alone never matched.
    const qualified = new Set<string>();
    for (const n of (thread?.nodes ?? []) as any[]) {
      if (n.kind !== "step" && n.kind !== "seed") continue;
      const segs = String(n.irNodeId ?? "").split("/").filter((s) => s.endsWith(".class") || s.endsWith(".fn")).map((s) => s.replace(/\.(class|fn)$/, ""));
      for (let i = 0; i < segs.length; i++) qualified.add(segs.slice(i).join(".").toLowerCase());
    }
    const called = new Set((stack.byThreadCalled?.[ep.id] ?? stack.byThread[ep.id] ?? []).map((x) => x.toLowerCase()));
    const missing: string[] = [];
    for (const step of t.primary) {
      const [head, ...rest] = step.split(":");
      const b = plan.boundaries.find((x) => x.id === head);
      if (b) {
        if (!called.has(b.to.toLowerCase()) && boundaryVerdict.get(b.id) !== "realised" && boundaryVerdict.get(b.id) !== "unverified") missing.push(step);
        continue;
      }
      const name = (rest.length ? rest.join(":") : head).trim().toLowerCase();
      if (!name || !(qualified.has(name) || labels.some((l) => l.includes(name)))) missing.push(step);
    }
    add(missing.length
      ? { section: "threads", id: t.id, verdict: "drifted", detail: `entry point ${ep.id} exists; not found on its thread: ${missing.join(", ")}`, entryPointId: ep.id }
      : { section: "threads", id: t.id, verdict: "realised", detail: `entry point ${ep.id}; every primary step found`, entryPointId: ep.id });
  }

  // ── planned rules, as advice ──
  const pols = live(plan.policies);
  if (pols.length) {
    let facts: ReturnType<typeof buildQualityFacts> | null = null;
    const registry = newRegistry();
    for (const p of pols) {
      if (p.status === "promoted") { add({ section: "policies", id: p.id, verdict: "prose", detail: `promoted to ${p.constraintId} — \`check\` and the hooks run it now` }); continue; }
      if (!p.check) { add({ section: "policies", id: p.id, verdict: "prose", detail: "no check — a reader's job" }); continue; }
      facts ??= buildQualityFacts({ envelope: env as never, root, commit, stack });
      let r: { verdict: string; reason: string } | null = null;
      if (isConstraintCheck(p.check)) r = checkConstraint(facts as never, p.check);
      else if (isRun1Check(p.check)) {
        // A `files`-scoped verb reads the files the rule names (statedScopeFiles).
        const own = (p.check as { scope?: string }).scope === "files" ? statedScopeFiles({ scope: { files: p.files ?? [] } } as never, files) : [];
        r = registry.run((own.length ? { ...facts, scopeFiles: own } : facts) as never, p.check as never);
      }
      add(r
        ? { section: "policies", id: p.id, verdict: r.verdict as PlanVerdict, detail: `${r.reason} (advice — a planned rule blocks nothing)` }
        : { section: "policies", id: p.id, verdict: "unverifiable", detail: "the check matches no verb in the constraint grammar" });
    }
  }

  const counts: Partial<Record<PlanVerdict, number>> = {};
  for (const f of findings) counts[f.verdict] = (counts[f.verdict] ?? 0) + 1;
  return { revision: plan.revision, findings, counts, limits: PLAN_RECONCILE_LIMITS, offObjective: offObjective(plan) };
}

// ── staying on the objective: a word-match guess, said as one ────────────

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "onto", "each", "every", "all", "any", "are", "was", "were", "has", "have", "its", "their", "our", "your", "them", "they", "can", "will", "should", "must", "within", "about", "over", "under", "when", "than", "then", "one", "per", "via", "not", "but", "also", "more", "less", "who", "what", "which", "how", "see", "get", "use", "make"]);
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
export function objectiveWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem).filter((w) => w.length >= 3));
}

/** Processes and threads whose `serves` shares no meaningful word with the
 *  objective. A GUESS: words are not meaning ("latency" serves "within a
 *  minute" and shares nothing), so it is a prompt to look, never a verdict. */
export function offObjective(plan: Plan): Array<{ section: "processes" | "threads"; id: string; serves: string }> {
  const obj = objectiveWords(plan.objective);
  if (!obj.size) return [];
  const out: Array<{ section: "processes" | "threads"; id: string; serves: string }> = [];
  const look = (section: "processes" | "threads", id: string, serves: string | null) => {
    if (!serves) return;
    if (![...objectiveWords(serves)].some((w) => obj.has(w))) out.push({ section, id, serves });
  };
  for (const p of plan.processes) if (p.status !== "dropped") look("processes", p.id, p.serves);
  for (const t of plan.threads) if (t.status !== "dropped") look("threads", t.id, t.serves);
  return out;
}
