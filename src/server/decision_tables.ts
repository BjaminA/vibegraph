// DECISION STRUCTURES from literal tables (2026-10-02, module 7). A table of
// rows with from/to fields is a state machine; a record of nodes with yes/no
// successors is a decision tree. Recognised by SHAPE — which fields the rows
// carry — never by the project's words. A node is linked to the function that
// evaluates it when another record maps the same keys to functions, and a
// machine to the functions that look rows up in its table.
//
// The field names are a taxonomy table: the words structure is spelled with,
// across codebases. Anything not matched is left alone, not guessed at.

import type { TopoDecisionNode, TopoDecisionTree, TopoStateMachine, TopoTransition } from "../shared/topology_types.ts";
import type { TableDecl, TableValue, TableRow } from "../shared/data_arch_types.ts";

export const DECISION_FIELDS = {
  from: ["from", "source", "fromState", "src", "before"],
  to: ["to", "target", "toState", "dst", "after", "next"],
  roles: ["roles", "role", "by", "actors", "allowed", "who", "allow"],
  requires: ["requires", "guards", "guard", "when", "conditions", "checks", "if"],
  label: ["label", "name", "title", "description"],
  yes: ["yes", "onYes", "ifYes", "true", "pass", "then"],
  no: ["no", "onNo", "ifNo", "false", "fail", "else"],
  question: ["question", "ask", "prompt", "text", "label"],
  evidence: ["reads", "evidence", "inputs", "uses", "needs", "fields"],
} as const;

type Role = keyof typeof DECISION_FIELDS;
const field = (row: TableRow, role: Role): TableValue | undefined => {
  for (const k of DECISION_FIELDS[role]) if (row.fields && k in row.fields) return row.fields[k];
  return undefined;
};

/** A table value as one name: a string, or the identifier a reference names. */
export function asName(v: TableValue | undefined): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && !Array.isArray(v) && "ref" in v) return v.ref;
  return null;
}

/** A table value as a list of names; a reference to a list table is resolved. */
export function asNames(v: TableValue | undefined, lists: (ref: string) => string[] | null): string[] | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.flatMap((x) => { const n = asName(x); if (n === null) return []; const l = typeof x === "object" && x && "ref" in x ? lists(n) : null; return l ?? [n]; });
  const n = asName(v);
  if (n === null) return null;
  return (typeof v === "object" && lists(n)) || [n];
}

interface IrFile { nodes?: Array<Record<string, any>> }

/** Functions that call a method on a table (`TABLE.find(...)`), per file. */
function lookersOf(name: string, files: Record<string, IrFile>): string[] {
  const out: string[] = [];
  for (const [file, ir] of Object.entries(files)) {
    const byId = new Map((ir.nodes ?? []).map((n) => [n.id, n]));
    for (const n of ir.nodes ?? []) {
      const callee = String(n.funcName ?? n.callTarget ?? "");
      if (callee.split(".")[0] !== name || !callee.includes(".")) continue;
      let p = byId.get(n.parentId);
      while (p && p.type !== "function_def") p = byId.get(p.parentId);
      if (p?.name && !out.includes(p.name)) out.push(p.name);
      void file;
    }
  }
  return out;
}

const cite = (d: TableDecl, line = d.line) => `${d.file}:${line}`;

export function stateMachinesFrom(tables: TableDecl[], files: Record<string, IrFile>, lists: (file: string, ref: string) => string[] | null): TopoStateMachine[] {
  const out: TopoStateMachine[] = [];
  for (const d of tables) {
    if (d.table.shape !== "rows" || !d.table.rows) continue;
    const rows = d.table.rows;
    if (rows.length < 2 || !rows.every((r) => typeof field(r, "from") === "string" && typeof field(r, "to") === "string")) continue;
    const transitions: TopoTransition[] = rows.map((r) => {
      const roles = asNames(field(r, "roles"), (ref) => lists(d.file, ref));
      const requires = asNames(field(r, "requires"), () => null);
      const label = asName(field(r, "label") as TableValue);
      return {
        from: field(r, "from") as string, to: field(r, "to") as string,
        ...(roles?.length ? { roles } : {}), ...(requires ? { requires } : {}),
        ...(label ? { label } : {}), cite: cite(d, r.line),
      };
    });
    const states = [...new Set(transitions.flatMap((t) => [t.from, t.to]))];
    const lookers = lookersOf(d.name, files);
    out.push({ id: d.name, states, transitions, ...(lookers.length ? { evaluatedBy: lookers.join(", ") } : {}), cite: cite(d) });
  }
  return out;
}

export function decisionTreesFrom(tables: TableDecl[]): TopoDecisionTree[] {
  const out: TopoDecisionTree[] = [];
  const evaluators = tables.filter((d) => d.table.shape === "record" && (d.table.rows ?? []).every((r) => r.value && typeof r.value === "object" && !Array.isArray(r.value) && "ref" in r.value));
  for (const d of tables) {
    if (d.table.shape !== "record" || !d.table.rows) continue;
    const rows = d.table.rows.filter((r) => r.key && r.fields);
    const branching = rows.filter((r) => asName(field(r, "yes")) !== null && asName(field(r, "no")) !== null);
    if (branching.length < 2 || branching.length < rows.length / 2) continue;
    const keys = new Set(rows.map((r) => r.key!));
    // the evaluator: a record mapping (most of) the same keys to functions
    const ev = evaluators
      .map((e) => ({ e, hit: (e.table.rows ?? []).filter((r) => keys.has(r.key!)).length }))
      .filter((x) => x.hit >= Math.max(2, keys.size / 2))
      .sort((a, b) => b.hit - a.hit || Number(b.e.file === d.file) - Number(a.e.file === d.file))[0]?.e;
    const evalOf = new Map((ev?.table.rows ?? []).map((r) => [r.key!, asName(r.value)]));
    const nodes: TopoDecisionNode[] = [];
    const leaves = new Set<string>();
    const pointed = new Set<string>();
    for (const r of rows) {
      const yes = asName(field(r, "yes")) ?? undefined;
      const no = asName(field(r, "no")) ?? undefined;
      for (const s of [yes, no]) if (s) { pointed.add(s); if (!keys.has(s)) leaves.add(s); }
      const question = asName(field(r, "question") as TableValue);
      const evidence = asNames(field(r, "evidence"), () => null);
      const fn = evalOf.get(r.key!);
      nodes.push({
        id: r.key!, ...(question ? { question } : {}), ...(yes ? { yes } : {}), ...(no ? { no } : {}),
        ...(evidence?.length ? { evidence } : {}), ...(fn ? { evaluatedBy: fn } : {}), cite: cite(d, r.line),
      } as TopoDecisionNode);
    }
    for (const l of leaves) nodes.push({ id: l, outcome: l });
    const root = rows.find((r) => !pointed.has(r.key!))?.key ?? rows[0].key!;
    out.push({ id: d.name, root, nodes, ...(ev ? { evaluatedByTable: `${ev.name} (${ev.file}:${ev.line})` } : {}), cite: cite(d) } as TopoDecisionTree);
  }
  return out;
}
