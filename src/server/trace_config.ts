// What the run recorder needs (2026-10-08, rung 4 of the run-time ladder),
// built from the static reading, zero tokens — `.vibegraph/trace/config.json`:
//
//   families   each zone and the name patterns that land in it, as anchored
//              regular expressions: the recorder maps a name to its zone in the
//              process and writes only the zone
//   ops        the method names the code's data operations use, and their verb
//   targets    the project class methods to wrap: a method the static reading
//              saw NAMING a resource on an operation's path (`Registry.meta`,
//              role "name": what it returns is that zone's), and a store's
//              access method the plan names (role "op": its first string
//              argument is the name)

import type { DataArchitecture } from "../shared/data_arch_types.ts";
import type { Plan } from "../shared/plan_types.ts";
import { effectOf } from "../shared/sdk_verbs.ts";

export interface TraceTarget { file: string; cls: string; method: string; role: "name" | "op"; op?: "watch" | "read" | "write" }
export interface TraceConfig { version: "1"; families: Array<{ zone: string; regex: string }>; ops: Record<string, "watch" | "read" | "write">; targets: TraceTarget[] }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `inbox_{Role}__{User}` → ^inbox_.+?__.+?$ (a hole is any run of characters) */
export const patternRegex = (p: string) => `^${p.split(/\{[^}]*\}/).map(escape).join(".+?")}$`;

const OP_OF: Record<string, "watch" | "read" | "write"> = { watch: "watch", read: "read", write: "write", admin: "write" };

export function buildTraceConfig(files: Record<string, { nodes?: any[] }>, da: DataArchitecture, plan: Plan | null | undefined): TraceConfig {
  const families: TraceConfig["families"] = [];
  const add = (zone: string, p: string) => { const regex = patternRegex(p); if (!families.some((f) => f.regex === regex)) families.push({ zone, regex }); };
  for (const f of da.topology.families ?? []) if (f.zone) { if (f.pattern) add(f.zone, f.pattern); add(f.zone, f.zone); }
  for (const z of da.topology.zones ?? []) add(z.id, z.id);
  // the verbs the code's method calls carry, by method name — classified the way
  // the data operations are (sdk_verbs.ts). Broad on purpose: the recorder
  // applies them only to an object a wrapped naming method handed out.
  const ops: TraceConfig["ops"] = {};
  for (const ir of Object.values(files)) for (const n of ir.nodes ?? []) {
    const callee = String(n?.funcName ?? n?.callTarget ?? "");
    if (!callee.includes(".")) continue;
    const method = callee.split(".").pop() ?? "";
    const op = OP_OF[effectOf(method) ?? ""];
    if (op && /^[A-Za-z_$][\w$]*$/.test(method)) ops[method] ??= op;
  }
  for (const c of da.sdkCalls ?? []) if (OP_OF[c.effect] && /^[A-Za-z_$][\w$]*$/.test(c.method)) ops[c.method] ??= OP_OF[c.effect];
  // class methods by name (`module/Registry.class/meta.fn` → Registry, meta)
  const classMethods = new Map<string, Array<{ file: string; cls: string }>>();
  for (const [file, ir] of Object.entries(files)) for (const n of ir.nodes ?? []) {
    const m = /(?:^|\/)([A-Za-z_$][\w$]*)\.class\/([A-Za-z_$][\w$]*)\.fn$/.exec(String(n?.id ?? ""));
    if (n?.type === "function_def" && m) classMethods.set(m[2], [...(classMethods.get(m[2]) ?? []), { file, cls: m[1] }]);
  }
  const targets: TraceTarget[] = [];
  const push = (t: TraceTarget) => { if (!targets.some((x) => x.file === t.file && x.cls === t.cls && x.method === t.method)) targets.push(t); };
  // a receiver that named the resource on a resolved operation's route
  for (const o of da.operations) for (const v of o.via ?? []) {
    if (v.includes("(")) continue;
    const method = v.split(".").pop() ?? "";
    for (const c of classMethods.get(method) ?? []) push({ ...c, method, role: "name" });
  }
  // a store's access methods the plan names
  for (const st of plan?.stores ?? []) for (const [verb, names] of Object.entries(st.access ?? {})) {
    for (const name of names ?? []) {
      const [cls, method] = name.includes(".") ? name.split(".").slice(-2) : [null, name];
      for (const c of classMethods.get(method) ?? []) if (!cls || c.cls === cls) push({ ...c, method, role: "op", op: OP_OF[verb] ?? "write" });
    }
  }
  return { version: "1", families, ops, targets };
}
