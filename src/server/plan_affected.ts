// RENAME SAFETY and change impact for the plan (2026-10-01). A plan names
// code: a thread's primary steps (`decide`, `Store.write`), a process's entry
// points, a zone's router, a store's access functions, a rule's targets.
// Rename `decide` and the plan silently stops matching — the agent finds out
// after the edit, from a "drifted" it has to work back from.
//
// `planAffected` answers BEFORE: which plan items name something the change
// touches (defined in a changed file, or a changed entry file), and which name
// is GONE — defined in a changed file at HEAD, defined nowhere now: renamed or
// removed. `renameSymbolRefs` is the other half: one op that updates every
// reference to a function across the plan.

import type { Plan } from "../shared/plan_types.ts";

export interface PlanRef {
  /** the name or file the plan uses */
  name: string;
  kind: "function" | "file";
  /** where the plan uses it: "threads POST /x step 2", "policies p3 target" */
  where: string;
}

export interface PlanImpact {
  /** named functions defined in a changed file, and entry files changed */
  touched: Array<PlanRef & { file: string }>;
  /** named functions a changed file defined at HEAD and nothing defines now */
  gone: Array<PlanRef & { file: string }>;
}

const FN_FIELDS = ["target", "with", "through", "producers", "by", "writes", "functions"] as const;
const strip = (step: string) => (step.includes(":") ? step.split(":").slice(1).join(":") : step).trim();

/** Every name and file the plan uses to point at code. */
export function planNamedRefs(plan: Plan): PlanRef[] {
  const out: PlanRef[] = [];
  const live = <T extends { status?: string }>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.status !== "dropped");
  for (const t of live(plan.threads)) {
    t.primary.forEach((s, i) => { const n = strip(s); if (n) out.push({ name: n, kind: "function", where: `threads ${t.id} step ${i + 1}` }); });
    if (t.entryPoint) out.push({ name: t.entryPoint.split(":")[0], kind: "file", where: `threads ${t.id} entryPoint` });
  }
  for (const p of live(plan.processes)) for (const e of p.entryPoints ?? []) out.push({ name: e.split(":")[0], kind: "file", where: `processes ${p.id} entryPoints` });
  for (const st of live(plan.stores)) {
    for (const [op, fns] of Object.entries(st.access ?? {})) for (const f of fns ?? []) out.push({ name: f, kind: "function", where: `stores ${st.id} access.${op}` });
    for (const z of st.zones ?? []) if (z.routedBy?.startsWith("router:")) out.push({ name: z.routedBy.slice(7).trim(), kind: "function", where: `stores ${st.id}/${z.id} router` });
  }
  for (const p of live(plan.policies)) {
    const c = (p.check ?? {}) as Record<string, unknown>;
    for (const k of FN_FIELDS) {
      const v = c[k];
      for (const n of Array.isArray(v) ? v : typeof v === "string" ? [v] : []) {
        if (typeof n === "string" && /^[A-Za-z_$][\w$.]*$/.test(n) && !(plan.processes.some((x) => x.id === n))) out.push({ name: n, kind: "function", where: `policies ${p.id} ${k}` });
      }
    }
  }
  return out;
}

/** Where each function name is defined NOW: bare and `Class.method`. */
function definitions(files: Record<string, any>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (name: string, file: string) => { if (!out.has(name)) out.set(name, new Set()); out.get(name)!.add(file); };
  for (const [file, ir] of Object.entries(files)) {
    for (const n of (ir?.nodes ?? []) as any[]) {
      if (n.type !== "function_def" || typeof n.name !== "string") continue;
      add(n.name, file);
      const cls = String(n.id).split("/").find((s) => s.endsWith(".class"));
      if (cls) add(`${cls.slice(0, -6)}.${n.name}`, file);
    }
  }
  return out;
}

/** A definition of `name` in a file's text, read as text (HEAD has no IR here). */
function definesInText(text: string, name: string): boolean {
  const last = name.split(".").pop()!.replace(/[$]/g, "\\$");
  return new RegExp(`(^|\\n)\\s*(export\\s+)?(default\\s+)?(async\\s+)?(def|function)\\s+${last}\\b|(^|\\n)\\s*(static\\s+|async\\s+|public\\s+|private\\s+|protected\\s+)*${last}\\s*\\([^)]*\\)\\s*(:\\s*[^={]+)?\\{|(const|let|var)\\s+${last}\\s*=\\s*(async\\s*)?(\\(|function)`).test(text);
}

export function planAffected(plan: Plan, files: Record<string, any>, changed: readonly string[], headText: (file: string) => string | null): PlanImpact {
  const defs = definitions(files);
  const changedSet = new Set(changed);
  const touched: PlanImpact["touched"] = [];
  const gone: PlanImpact["gone"] = [];
  for (const r of planNamedRefs(plan)) {
    if (r.kind === "file") {
      if (changedSet.has(r.name)) touched.push({ ...r, file: r.name });
      continue;
    }
    const where = [...(defs.get(r.name) ?? [])];
    const hit = where.find((f) => changedSet.has(f));
    if (hit) { touched.push({ ...r, file: hit }); continue; }
    if (where.length) continue;
    const was = changed.find((f) => { const t = headText(f); return t !== null && definesInText(t, r.name); });
    if (was) gone.push({ ...r, file: was });
  }
  return { touched, gone };
}

export function formatPlanAffected(i: PlanImpact): string {
  if (!i.touched.length && !i.gone.length) return "the change touches nothing the plan names.";
  const lines: string[] = [];
  if (i.gone.length) {
    lines.push("GONE — the plan names these, a changed file defined them at HEAD, and nothing defines them now (renamed or removed?):");
    for (const g of i.gone) lines.push(`  ${g.name} (${g.where}; was in ${g.file}) — if renamed: plan edit '{"op":"rename-symbol","from":"${g.name}","to":"<new name>"}'`);
  }
  if (i.touched.length) {
    lines.push("Touched — the plan names these and the change edits where they live:");
    for (const t of i.touched) lines.push(`  ${t.name} (${t.where}; ${t.file})`);
  }
  return lines.join("\n");
}

/** One op's work: rename a FUNCTION everywhere the plan names it — thread
 *  steps (`b1:old` keeps its boundary), routers, access functions, rule
 *  targets. Returns how many references changed. Mutates `plan`. */
export function renameSymbolRefs(plan: Plan, from: string, to: string): number {
  let n = 0;
  const swap = (v: string) => (v === from ? (n++, to) : v);
  for (const t of plan.threads) {
    t.primary = t.primary.map((s) => {
      const head = s.includes(":") ? `${s.split(":")[0]}:` : "";
      const body = s.slice(head.length);
      return body === from ? (n++, `${head}${to}`) : s;
    });
  }
  for (const st of plan.stores ?? []) {
    for (const k of ["write", "read", "watch"] as const) if (st.access?.[k]) st.access[k] = st.access[k]!.map(swap);
    for (const z of st.zones ?? []) if (z.routedBy === `router: ${from}` || z.routedBy === `router:${from}`) { n++; z.routedBy = `router: ${to}`; }
  }
  for (const p of plan.policies) {
    const c = p.check as Record<string, unknown> | undefined;
    if (!c) continue;
    for (const k of FN_FIELDS) {
      const v = c[k];
      if (typeof v === "string") c[k] = swap(v);
      else if (Array.isArray(v)) c[k] = v.map((x) => (typeof x === "string" ? swap(x) : x));
    }
  }
  return n;
}
