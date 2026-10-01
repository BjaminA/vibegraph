// LAYERING in the plan (2026-10-01). A planned rule may carry a `layer` check
// — "module M may import only modules […] and tools […]" — written with the
// plan's MODULE ids as shorthand (`"files": ["decisions"]`). The grammar the
// rule is checked by (and promoted into constraints.json through) speaks
// folders, because constraints.json knows no plan, so a module id is expanded
// to its folder in both places. `proposeLayers` offers the import graph as it
// is today as the starting rule for each module: a proposal to tighten, never
// a decision.

import type { Plan, PlanPolicy } from "../shared/plan_types.ts";
import type { PlanOp } from "./plan_ops.ts";
import { currentLayer } from "./arch_checks.ts";
import type { ImportEdge } from "./import_graph.ts";

/** A planned rule's check with the plan's own names expanded to what the
 *  grammar reads (constraints.json knows no plan):
 *   - layer          module ids → their folders;
 *   - single-writer  `zone: "store/zone"` → that store's write functions, the
 *                    zone's id and the families it holds; process ids in `by`
 *                    → the process's own files (its `at` folder, its entry points);
 *   - id-scheme      no `writes` → every planned store's write functions. */
export function expandModuleRefs(check: Record<string, unknown> | undefined, plan: Plan): Record<string, unknown> | undefined {
  if (!check) return check;
  const stores = plan.stores ?? [];
  if (check.rule === "layer") {
    const at = new Map((plan.modules ?? []).map((m) => [m.id, `${m.at.replace(/\/$/, "")}/`]));
    const map = (xs: unknown) => (Array.isArray(xs) ? xs.map((x) => (typeof x === "string" && at.has(x) ? at.get(x)! : x)) : xs);
    return { ...check, files: map(check.files), mayImport: map(check.mayImport) };
  }
  if (check.rule === "single-writer") {
    const out: Record<string, unknown> = { ...check };
    if (typeof check.zone === "string" && check.zone.includes("/")) {
      const [sid, zid] = check.zone.split("/");
      const st = stores.find((x) => x.id === sid);
      const z = st?.zones?.find((x) => x.id === zid);
      if (st && z) {
        out.zone = z.id;
        if (!out.writes) out.writes = st.access?.write ?? [];
        if (!out.families) out.families = z.holds;
      }
    }
    const procs = new Map(plan.processes.map((p) => [p.id, p]));
    const by = Array.isArray(check.by) ? (check.by as string[]) : [];
    const procFiles = by.filter((b) => procs.has(b)).flatMap((b) => {
      const p = procs.get(b)!;
      return [...(p.at ? [`${p.at.replace(/\/$/, "")}/`] : []), ...(p.entryPoints ?? []).map((e) => e.split(":")[0])];
    });
    if (procFiles.length) {
      const fns = by.filter((b) => !procs.has(b));
      if (fns.length) out.by = fns; else delete out.by;
      out.files = [...((check.files as string[] | undefined) ?? []), ...procFiles];
    }
    return out;
  }
  if (check.rule === "id-scheme" && !check.writes) {
    return { ...check, writes: [...new Set(stores.flatMap((x) => x.access?.write ?? []))] };
  }
  return check;
}

/** One proposed layer rule per planned module, from what it imports today. */
export function proposeLayers(plan: Plan, edges: ImportEdge[]): { ops: PlanOp[]; lines: string[] } {
  const folderOf = new Map((plan.modules ?? []).filter((m) => m.status !== "dropped").map((m) => [`${m.at.replace(/\/$/, "")}/`, m.id]));
  const covered = new Set(plan.policies.filter((p) => p.status !== "dropped" && p.check?.rule === "layer").flatMap((p) => (p.check?.files as string[] | undefined) ?? []));
  const ops: PlanOp[] = [];
  const lines: string[] = [];
  for (const m of (plan.modules ?? []).filter((x) => x.status !== "dropped")) {
    if (covered.has(m.id)) { lines.push(`${m.id}: already has a layer rule — skipped`); continue; }
    const folder = `${m.at.replace(/\/$/, "")}/`;
    const cur = currentLayer(edges, [folder]);
    if (!cur.seen) { lines.push(`${m.id}: no parsed file under ${folder} imports anything yet — nothing to propose`); continue; }
    // Another planned module's folder reads as its id.
    const may = cur.mayImport.map((t) => [...folderOf].find(([f]) => t.startsWith(f) || f.startsWith(t))?.[1] ?? t);
    const uniq = [...new Set(may)];
    const item: Partial<PlanPolicy> = {
      text: `${m.id} imports only ${uniq.length ? uniq.join(", ") : "itself and the standard library"}`,
      why: `proposed from the import graph: what ${m.id} imports today — tighten it to the decision you mean, then agree it`,
      check: { rule: "layer", files: [m.id], mayImport: uniq },
      status: "proposed",
    };
    ops.push({ op: "add", section: "policies", item: item as Record<string, unknown> });
    lines.push(`${m.id}: may import ${uniq.join(", ") || "(nothing outside itself)"} (${cur.seen} import(s) read)`);
  }
  return { ops, lines };
}
