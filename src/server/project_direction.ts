// PROJECT DIRECTION (2026-10-16, from a review: direction was six shipped
// skills a project could not extend, two of which fire everywhere and so
// select nothing, while the plan's principles reached no session but the
// hooks). The project's own "how we do things here", READ FROM ITS FACTS:
//
//   funnel   a tool the project reaches through a module of its own — the
//            stack index's funnel (`wraps`, `home`) — becomes "reach <tool>
//            through <funnel>", checked by `import-only` (allowTests);
//   guard    a data zone whose every write runs behind one check
//            (write_guards.ts) becomes "writes to <zone> are decided by <check>";
//   plan     an AGREED plan principle (policy) is carried as it is, its check
//            with it.
//
// Zero tokens. The census PROPOSES; only a person agrees or drops. A rule a
// person dropped is never proposed again (the facts can change; the decision
// stands). An agreed rule whose facts moved is marked `changed` — never
// silently re-worded under the person's agreement, never un-agreed either.
// Direction is advice: it reaches the session as headlines and is checked
// after edits as a note; a rule that must block is a stated rule.

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type { ProjectDirection, ProjectRule } from "../shared/project_direction_wire.ts";
import type { ArchModelRecord, StackToolRecord } from "../shared/protocol.ts";
import type { Plan } from "../shared/plan_types.ts";
import { isTestFile } from "../shared/path_match.ts";
import { guardedWrites, type IrNodeLike } from "./write_guards.ts";

export type { ProjectDirection, ProjectRule } from "../shared/project_direction_wire.ts";

export const DIRECTION_FILE = path.join(".vibegraph", "direction.json");
const EMPTY: ProjectDirection = { version: "1", rules: [] };
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 12);

export function loadDirection(root: string): ProjectDirection {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, DIRECTION_FILE), "utf-8"));
    if (raw?.version !== "1" || !Array.isArray(raw.rules)) return { ...EMPTY, rules: [] };
    const rules = (raw.rules as ProjectRule[]).filter((r) => r && typeof r.id === "string" && typeof r.text === "string"
      && typeof r.basis === "string" && ["proposed", "agreed", "dropped"].includes(r.status));
    return { version: "1", rules, ...(typeof raw.censusAt === "string" ? { censusAt: raw.censusAt } : {}) };
  } catch { return { ...EMPTY, rules: [] }; }
}

export function saveDirection(root: string, d: ProjectDirection): void {
  const file = path.join(root, DIRECTION_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(d, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}

export type Candidate = Omit<ProjectRule, "id" | "status" | "decided" | "changed" | "missing">;

export interface CensusInput {
  stack: { tools: StackToolRecord[] };
  model: Pick<ArchModelRecord, "nodes" | "edges">;
  files: Record<string, { nodes?: IrNodeLike[] }>;
  plan?: Plan | null;
}

/** What the facts show the project already does, as candidate rules. */
export function census(input: CensusInput): Candidate[] {
  const out: Candidate[] = [];
  const toolByName = new Map(input.stack.tools.map((t) => [t.tool, t]));
  // funnel — a project module that wraps a tool, used by several files
  for (const f of input.stack.tools) {
    if (f.origin !== "project" || !f.home || !(f.wraps ?? []).length) continue;
    const users = f.files.filter((x) => x !== f.home && !isTestFile(x));
    if (users.length < 2) continue;
    for (const w of f.wraps ?? []) {
      const direct = (toolByName.get(w)?.files ?? []).filter((x) => x !== f.home && !isTestFile(x));
      // a habit, not a wish: most of the tool's use already goes through the funnel
      if (direct.length * 4 > users.length) continue;
      // `import-only` sees an import: a language global (fetch) is never
      // imported, so a check would pass on nothing — said, not checked
      const imported = (toolByName.get(w) as { evidence?: Array<{ kind?: string }> } | undefined)?.evidence?.some((e) => e.kind === "import" || e.kind === "include");
      out.push({
        text: `Reach ${w} through ${f.tool} (${f.home}), not directly`,
        why: `${users.length} files use ${w} through ${f.home}; ${direct.length ? `${direct.length} reach it directly (${direct.slice(0, 3).join(", ")}${direct.length > 3 ? ", …" : ""})` : "none reach it directly"} — the funnel is the one place its use can change${imported ? "" : ` (${w} is a language global, not imported: not checked)`}`,
        basis: `funnel:${w}`, evidence: [f.home],
        ...(imported ? { check: { rule: "import-only", tool: w, files: [f.home], allowTests: true } } : {}),
        files: [f.home, ...users].slice(0, 40),
        stamp: hash({ f: f.home, w, users: users.length, direct }),
      });
    }
  }
  // guard — every write to a zone runs behind one check
  const sites = new Map<string, number>();
  for (const e of input.model.edges) if (e.to.startsWith("zone:") && e.protocol === "write") sites.set(e.to, (sites.get(e.to) ?? 0) + (e.refs ?? []).filter((r) => r.nodeId).length);
  const byZone = new Map<string, ReturnType<typeof guardedWrites>>();
  for (const g of guardedWrites(input.model as never, input.files)) (byZone.get(g.zone) ?? byZone.set(g.zone, []).get(g.zone)!).push(g);
  const label = new Map(input.model.nodes.map((n) => [n.id, n.label]));
  for (const [zone, ws] of byZone) {
    const total = sites.get(zone) ?? 0;
    if (ws.length < 2 || ws.length !== total) continue;
    const fnOf = (check: string) => /^[A-Za-z_$][\w$.]*/.exec(check)?.[0] ?? check;
    const common = [...new Set(ws.flatMap((w) => w.guards.map((g) => fnOf(g.check))))].filter((fn) => ws.every((w) => w.guards.some((g) => fnOf(g.check) === fn)));
    if (!common.length) continue;
    const fn = common[0];
    const holds = ws.filter((w) => w.guards.some((g) => fnOf(g.check) === fn && g.when === "holds")).length;
    const name = label.get(zone) ?? zone;
    out.push({
      text: `Every write to ${name} is decided by ${fn}(…)`,
      why: `all ${ws.length} writes to ${name} in the code run behind ${fn}: ${holds} only when it holds, ${ws.length - holds} only when it fails (${ws.slice(0, 3).map((w) => `${w.file}:${w.line}`).join(", ")}${ws.length > 3 ? ", …" : ""})`,
      basis: `guard:${zone}`, evidence: ws.map((w) => `${w.file}:${w.line}`).slice(0, 8),
      files: [...new Set(ws.map((w) => w.file))],
      stamp: hash(ws.map((w) => [w.file, w.line, w.guards])),
    });
  }
  // plan — an agreed principle, as the plan states it
  for (const p of input.plan?.policies ?? []) {
    if (p.status !== "agreed") continue;
    out.push({
      text: p.text, why: p.why || "the agreed plan states it", basis: `plan:policies:${p.id}`, evidence: [`plan:policies:${p.id}`],
      ...(p.check ? { check: p.check } : {}), ...(p.files?.length ? { files: p.files } : {}),
      stamp: hash([p.text, p.why, p.check ?? null, p.files ?? null]),
    });
  }
  return out;
}

/** Fold a census into the store: new → PROPOSED; a person's decision stands. */
export function mergeCensus(d: ProjectDirection, found: Candidate[], now = new Date()): { direction: ProjectDirection; added: number; changed: number } {
  const rules = d.rules.map((r) => ({ ...r }));
  const byBasis = new Map(rules.map((r) => [r.basis, r]));
  let next = rules.reduce((m, r) => Math.max(m, Number(/^d(\d+)$/.exec(r.id)?.[1] ?? 0)), 0);
  let added = 0, changed = 0;
  for (const c of found) {
    const was = byBasis.get(c.basis);
    if (!was) { rules.push({ ...c, id: `d${++next}`, status: "proposed" }); added++; continue; }
    if (was.status === "dropped") { was.stamp = c.stamp; continue; }
    if (was.status === "agreed") {
      delete was.missing;
      if (was.stamp !== c.stamp) { was.changed = true; changed++; }
      continue; // agreed wording stays as agreed
    }
    Object.assign(was, c);
  }
  const seen = new Set(found.map((c) => c.basis));
  for (const r of rules) if (!seen.has(r.basis) && r.status === "agreed") r.missing = true;
  return { direction: { version: "1", rules: rules.filter((r) => seen.has(r.basis) || r.status !== "proposed"), censusAt: now.toISOString() }, added, changed };
}

/** A person agrees to or drops a rule. Agreeing re-reads it: `changed` clears. */
export function decideRule(d: ProjectDirection, id: string, decision: "agree" | "drop", by: string, now = new Date()): string | null {
  const r = d.rules.find((x) => x.id === id);
  if (!r) return `no direction rule ${id}`;
  r.status = decision === "agree" ? "agreed" : "dropped";
  r.decided = { by, at: now.toISOString() };
  delete r.changed;
  return null;
}

/** The agreed rules about a thread's files (a rule with no files is about every thread). */
export function rulesFor(d: ProjectDirection, filesReached: readonly string[]): ProjectRule[] {
  const files = new Set(filesReached);
  return d.rules.filter((r) => r.status === "agreed" && (!r.files?.length || r.files.some((f) => files.has(f) || [...files].some((x) => x.startsWith(f.endsWith("/") ? f : `${f}/`)))));
}

export const ruleLine = (r: ProjectRule) => `- ${r.id}: ${r.text}${r.changed ? " (the facts moved since it was agreed)" : ""}`;
