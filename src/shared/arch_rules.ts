// Group membership by RULE (2026-10-05). A ratified group used to name the
// exact boxes it wrapped, so every cluster added later fell outside every
// group, silently. A group may now also carry `match`: rules over facts the
// derived map already holds, so new code that fits a rule joins the group
// with no model and no tokens.
//
// A rule is a conjunction of the fields it gives; a group's `match` is a
// disjunction of rules. Precedence, so a box lands in ONE group:
//   1. a group that names the box in `wraps` (a person or the ratified
//      proposal said so) — a rule never takes it elsewhere;
//   2. a group that `exclude`s it never gets it;
//   3. among the rules that match, the most SPECIFIC (longest path prefix,
//      then the most fields), then the group that comes first.
// Pure and webview-safe: the server, the CLI and the tests share it.

import type { ArchModelRecord, ArchNodeRecord } from "./protocol.ts";

export interface GroupRule {
  /** the box kind */
  kind?: "cluster" | "tool" | "hub";
  /** a cluster's or hub's package root starts with this ("" = the project root itself) */
  rootPrefix?: string;
  /** any of its entry points' files starts with this */
  pathPrefix?: string;
  /** cluster family is one of (web | api | mcp | scripts | cli | model | library) */
  family?: string[];
  /** any of its frameworks is one of */
  framework?: string[];
  /** a tool's role is one of */
  role?: string[];
  /** a tool's name is one of; a name ending "/" is a package scope ("@acme/") */
  tool?: string[];
}

export interface RuleGroupLike { id: string; wraps: string[]; match?: GroupRule[]; exclude?: string[] }

const RULE_KEYS = ["kind", "rootPrefix", "pathPrefix", "family", "framework", "role", "tool"] as const;
const PATH = /^[\w@.\-/ ]{0,160}$/;
const WORD = /^[\w@.\-/:]{1,80}$/;

/** A rule as written, or the reason it is not one. Nothing is coerced. */
export function validateRule(raw: unknown): { rule?: GroupRule; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "a rule is an object" };
  const r = raw as Record<string, unknown>;
  const extra = Object.keys(r).filter((k) => !(RULE_KEYS as readonly string[]).includes(k));
  if (extra.length) return { error: `unknown rule field(s): ${extra.join(", ")} — use ${RULE_KEYS.join(", ")}` };
  const out: GroupRule = {};
  if (r.kind !== undefined) {
    if (r.kind !== "cluster" && r.kind !== "tool" && r.kind !== "hub") return { error: "kind is cluster, tool or hub" };
    out.kind = r.kind;
  }
  for (const k of ["rootPrefix", "pathPrefix"] as const) {
    if (r[k] === undefined) continue;
    if (typeof r[k] !== "string" || !PATH.test(r[k] as string) || (r[k] as string).includes("..")) return { error: `${k} is a relative path prefix` };
    out[k] = r[k] as string;
  }
  for (const k of ["family", "framework", "role", "tool"] as const) {
    if (r[k] === undefined) continue;
    const list = r[k];
    if (!Array.isArray(list) || !list.length || list.length > 20 || !list.every((x) => typeof x === "string" && WORD.test(x))) return { error: `${k} is a list of names` };
    out[k] = list as string[];
  }
  if (!Object.keys(out).length) return { error: "an empty rule would match everything" };
  if (out.kind === undefined && out.rootPrefix === undefined && out.pathPrefix === undefined && !out.family && !out.tool) {
    return { error: "a rule needs at least one of kind, rootPrefix, pathPrefix, family or tool — a framework or role alone matches across the whole project" };
  }
  return { rule: out };
}

const entryFile = (e: string) => e.split(":")[0];

export function matchesRule(n: ArchNodeRecord, r: GroupRule): boolean {
  if (n.kind === "actor") return false;
  if (r.kind && n.kind !== r.kind) return false;
  if (r.rootPrefix !== undefined) {
    if (n.kind === "tool" || n.root === undefined) return false;
    const root = n.root === "." ? "" : n.root.replace(/\/$/, "");
    const p = r.rootPrefix.replace(/\/$/, "");
    if (p === "" ? root !== "" : !(root === p || root.startsWith(`${p}/`))) return false;
  }
  if (r.pathPrefix !== undefined && !(n.entryPoints ?? []).some((e) => entryFile(e).startsWith(r.pathPrefix!))) return false;
  if (r.family && !(n.family && r.family.includes(n.family))) return false;
  if (r.framework && !(n.frameworks ?? []).some((f) => r.framework!.includes(f))) return false;
  if (r.role && !(n.role && r.role.includes(n.role))) return false;
  if (r.tool) {
    const t = n.tool;
    if (!t || !r.tool.some((x) => (x.endsWith("/") ? t.startsWith(x) : t === x))) return false;
  }
  return true;
}

/** How specific a rule is: path prefix length first, then how many fields. */
function specificity(r: GroupRule): number {
  return Math.max(r.rootPrefix?.length ?? -1, r.pathPrefix?.length ?? -1) * 100 + Object.keys(r).length;
}

/** Every group's effective members: what it names, plus the boxes its rules
 *  claim (by the precedence above). `byRule` — the ones a rule brought in. */
export function resolveMembers(groups: readonly RuleGroupLike[], model: Pick<ArchModelRecord, "nodes">): Map<string, { members: string[]; byRule: string[] }> {
  const ids = new Set(model.nodes.map((n) => n.id));
  const named = new Set(groups.flatMap((g) => g.wraps.filter((w) => ids.has(w))));
  const out = new Map(groups.map((g) => [g.id, { members: g.wraps.filter((w) => ids.has(w) || groups.some((x) => x.id === w)), byRule: [] as string[] }]));
  for (const n of model.nodes) {
    if (named.has(n.id)) continue;
    let best: { g: RuleGroupLike; s: number } | null = null;
    for (const g of groups) {
      if (!g.match?.length || g.exclude?.includes(n.id)) continue;
      for (const r of g.match) {
        if (!matchesRule(n, r)) continue;
        const s = specificity(r);
        if (!best || s > best.s) best = { g, s };
      }
    }
    if (best) {
      const e = out.get(best.g.id)!;
      e.members.push(n.id);
      e.byRule.push(n.id);
    }
  }
  return out;
}

/** A rule in a few words, for a tooltip, a note or a prompt. */
export function describeRule(r: GroupRule): string {
  const bits: string[] = [];
  if (r.kind) bits.push(`${r.kind}s`);
  if (r.rootPrefix !== undefined) bits.push(r.rootPrefix === "" ? "at the project root" : `under ${r.rootPrefix}`);
  if (r.pathPrefix !== undefined) bits.push(`starting in ${r.pathPrefix}`);
  if (r.family) bits.push(`family ${r.family.join("|")}`);
  if (r.framework) bits.push(`framework ${r.framework.join("|")}`);
  if (r.role) bits.push(`role ${r.role.join("|")}`);
  if (r.tool) bits.push(`tool ${r.tool.join("|")}`);
  return bits.join(", ");
}
