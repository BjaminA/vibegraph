// EFFECTIVE WRITERS (2026-10-02, "the location split", M3). The catalogue's
// writer field is the INPUT of the function that decides who may write each
// zone; the function's RESULT is what the store enforces. A common shape:
//
//   function writersByZone() {
//     const out = {};
//     const add = (k, w) => { out[k] = [...new Set([...(out[k] ?? []), ...w])]; };
//     for (const d of CATALOGUE) add(familyOf(d.path), d.write);   // the table
//     out.status = [SERVICE];                                       // replaces
//     add("audit", [SERVICE]);                                      // unions
//     for (const p of people) out[`req_${p.id}`] = [p.id];          // per person: computed
//     return out;
//   }
//
// This reads that much and no more: in a function that reads the catalogue's
// writer field, the literal-keyed assignments and adder calls AFTER the
// catalogue loop, with module string constants resolved. A dynamic key, or a
// value it cannot resolve, is listed with its line — never guessed.

import type { TableDecl } from "../shared/data_arch_types.ts";
import { RESOURCE_FIELDS, type Family } from "./data_topology.ts";
import { unifies } from "../shared/name_pattern.ts";

interface Node { id: string; type: string; parentId?: string | null; name?: string; line?: number; endLine?: number; funcName?: string; callTarget?: string; args?: string[]; preview?: string; value?: string | null; valueKind?: string; params?: string[] }

const lit = (t: string) => { const m = /^\s*(["'`])([^"'`$]*)\1\s*$/.exec(t); return m ? m[2] : null; };

export interface Overrides { families: Family[]; notes: string[]; computed: string[] }

export function applyWriterOverrides(files: Record<string, { nodes?: Node[] }>, catalogue: TableDecl | null, families: Family[]): Overrides {
  const notes: string[] = [];
  const computed: string[] = [];
  if (!catalogue) return { families, notes, computed };
  const writerField = new RegExp(`\\.(${RESOURCE_FIELDS.writers.join("|")})\\b`);
  const out = families.map((f) => ({ ...f, writers: [...f.writers] }));
  const zoneOf = (key: string) => out.find((f) => f.zone === key) ?? out.find((f) => /\{/.test(f.zone) && unifies(f.zone, key));
  for (const [file, ir] of Object.entries(files)) {
    const nodes = ir.nodes ?? [];
    const consts = new Map(nodes.filter((n) => n.type === "assignment" && !n.parentId && n.valueKind === "string").map((n) => [n.name!, lit(n.preview ?? "")]));
    const resolve = (t: string): string | null => lit(t) ?? (/^[A-Za-z_$][\w$]*$/.test(t.trim()) ? consts.get(t.trim()) ?? null : null);
    const listOf = (n: Node): { values: string[]; unresolved: string[] } => {
      const items = n.valueKind === "list" || (n.args && !n.funcName) ? (n.args ?? []) : (n.preview ?? "").replace(/^\[|\]$/g, "").split(",");
      const values: string[] = [], unresolved: string[] = [];
      for (const it of items.map((x) => x.trim()).filter(Boolean)) { const v = resolve(it); if (v !== null) values.push(v); else unresolved.push(it); }
      return { values, unresolved };
    };
    for (const fn of nodes.filter((n) => n.type === "function_def" && !n.parentId)) {
      const inside = nodes.filter((n) => (n.line ?? 0) >= (fn.line ?? 0) && (n.endLine ?? n.line ?? 0) <= (fn.endLine ?? 0) && n.id.startsWith(`${fn.id}/`));
      // it reads the catalogue's writer field inside a loop over the catalogue
      const loop = inside.find((n) => n.type === "for_loop" && inside.some((x) => x.id.startsWith(`${n.id}/`) && (x.args ?? []).some((a) => writerField.test(a))));
      if (!loop || !JSON.stringify(inside).includes(catalogue.name)) continue;
      // the record it builds (an empty object it returns) and its adder helpers
      const rec = inside.find((n) => n.type === "assignment" && (n.preview ?? "").trim() === "{}" && inside.some((r) => r.type === "return_stmt" && (r.value ?? "").trim() === n.name))?.name;
      if (!rec) continue;
      const adders = new Set(inside.filter((n) => n.type === "function_def" && inside.some((a) => a.type === "assignment" && a.id.startsWith(`${n.id}/`) && (a.name ?? "").startsWith(`${rec}[`))).map((n) => n.name!));
      const after = inside.filter((n) => (n.line ?? 0) > (loop.endLine ?? loop.line ?? 0)).sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
      const at = (n: Node) => `${file}:${n.line}`;
      for (const n of after) {
        let key: string | null = null, mode: "replace" | "union" | null = null, vals: { values: string[]; unresolved: string[] } | null = null;
        const dot = n.type === "assignment" ? new RegExp(`^${rec}(?:\\.([A-Za-z_$][\\w$]*)|\\[\\s*(["'])([^"']+)\\2\\s*\\])$`).exec(n.name ?? "") : null;
        if (dot) { key = dot[1] ?? dot[3]; mode = "replace"; vals = listOf(n); }
        else if (n.type === "assignment" && (n.name ?? "").startsWith(`${rec}[`)) {
          computed.push(`${at(n)}: \`${n.name}\` sets writers under a key built at run time — those zones' writers are not read`);
          continue;
        } else if (n.type === "call" && adders.has(n.funcName ?? "") && (n.args?.length ?? 0) >= 2) {
          key = lit(n.args![0]); mode = "union";
          vals = listOf({ ...n, funcName: undefined, args: undefined, valueKind: "other", preview: n.args![1] } as Node);
          if (key === null) { computed.push(`${at(n)}: \`${n.funcName}(${n.args![0]}, …)\` adds writers under a key built at run time`); continue; }
        }
        if (!key || !mode || !vals) continue;
        const fam = zoneOf(key);
        if (!fam) { computed.push(`${at(n)}: writers set for \`${key}\`, which is no zone the catalogue declares`); continue; }
        if (vals.unresolved.length) computed.push(`${at(n)}: ${vals.unresolved.join(", ")} not resolved to a literal`);
        fam.writers = mode === "replace" ? vals.values : [...new Set([...fam.writers, ...vals.values])];
        fam.cite = at(n);
        notes.push(`${fam.zone}: writers ${mode === "replace" ? "replaced" : "extended"} at ${at(n)} in \`${fn.name}\` → ${fam.writers.join(", ")}`);
      }
    }
  }
  return { families: out, notes, computed };
}
