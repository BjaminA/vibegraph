// Using a RATIFIED software spec (2026-09-30): where it applies in the code,
// which calls are its operations, what a hooked session is told, how it reads
// as a page, and how it enters a plan. Pure — specs and IR in, text out.

import type { SoftwareSpec, SoftwareRule } from "../shared/software_types.ts";
import { SOFTWARE_CAPS } from "../shared/software_types.ts";
import { PLAN_CAPS } from "../shared/plan_types.ts";
import type { PlanOp } from "./plan_ops.ts";

interface FileIr { nodes?: Array<{ type: string; module?: string; names?: string[]; funcName?: string; callTarget?: string; line?: number }> }

/** An import names this tool: the package itself, a subpath of it, or (for a
 *  scope like `@tdxvolt`) any package in the scope. */
export function importMatches(spec: SoftwareSpec, module: string): boolean {
  return spec.identity.packages.some((p) => module === p || module.startsWith(`${p}/`) || (p.startsWith("@") && !p.includes("/") && module.startsWith(`${p}/`)));
}

/** A call names one of its operations: `api.PutBlob(…)`, `PutBlob(…)`. */
export function callMatches(spec: SoftwareSpec, callee: string): string | null {
  const last = callee.split(/[.:]/).pop() ?? callee;
  return spec.identity.calls.find((c) => c === last || c === callee) ?? null;
}

export interface OperationCall { file: string; line: number | null; call: string; operation: string; does: string; on?: string }

/** Where a spec shows up in these files: the imports, and every call that is
 *  one of its operations (with what the spec says it does). */
export function specUsage(spec: SoftwareSpec, files: Record<string, FileIr>, only?: Iterable<string>): { imports: string[]; calls: OperationCall[] } {
  const imports = new Set<string>();
  const calls: OperationCall[] = [];
  const ops = new Map(spec.operations.map((o) => [o.name, o]));
  for (const f of only ? [...only] : Object.keys(files)) {
    for (const n of files[f]?.nodes ?? []) {
      if (n.type === "import" || n.type === "import_from") {
        // `import x` keeps the module in `names` (python); `from x import y` in `module`.
        const mods = n.module ? [n.module] : (n.names ?? []).map((m) => m.split(/\s+as\s+/)[0]);
        if (mods.some((m) => importMatches(spec, m))) imports.add(f);
      } else if (n.type === "call" || n.callTarget) {
        // A call is a `call` node, or a statement that IS one (return f(), x = f()).
        const callee = (n.type === "call" ? n.funcName ?? n.callTarget : n.callTarget) ?? "";
        const op = callee ? callMatches(spec, callee) : null;
        if (op) calls.push({ file: f, line: n.line ?? null, call: callee, operation: op, does: ops.get(op)?.does ?? "call", ...(ops.get(op)?.on ? { on: ops.get(op)!.on } : {}) });
      }
    }
  }
  return { imports: [...imports].sort(), calls };
}

/** The specs a thread touches (its files import the tool or call its operations). */
export function specsForFiles(specs: SoftwareSpec[], files: Record<string, FileIr>, reached: string[]): SoftwareSpec[] {
  return specs.filter((s) => { const u = specUsage(s, files, reached); return u.imports.length > 0 || u.calls.length > 0; });
}

/** Where an item came from, said the same way everywhere. */
const q = (c: string | null, by?: string) =>
  c ? `"${c.length > 90 ? `${c.slice(0, 87)}…` : c}"${by === "human" ? " (edited by a person)" : by === "agent" ? " (edited by a model after drafting)" : ""}`
  : by === "human" ? "STATED by a person — not in the docs"
  : by === "agent" ? "added by a model after drafting — not in the docs"
  : "INFERRED — not in its docs";
const tag = (c: string | null, by?: string) => (c ? "" : by === "human" ? " [stated by a person]" : " [not in the docs]");
const stateText = (s: { values: string[]; kind?: string }) => s.values.join(s.kind === "choice" ? " | " : " → ");

/** The rules a session is always told: the ones marked core, or — when none
 *  is — the first few. The rest are on demand. */
export function coreRules(spec: SoftwareSpec): { core: SoftwareRule[]; rest: number } {
  const marked = spec.rules.filter((r) => r.core);
  const core = marked.length ? marked : spec.rules.slice(0, SOFTWARE_CAPS.core);
  return { core, rest: spec.rules.length - core.length };
}

/** The compact form a hooked session receives, once per session per spec. */
export function specHeadlines(spec: SoftwareSpec, calls: OperationCall[] = []): string {
  const lines = [`## Software: ${spec.tool}${spec.vendor ? ` (${spec.vendor})` : ""} — ${spec.role}; a ratified spec cited from its own docs`, spec.definition];
  if (calls.length) lines.push(`This code calls it: ${calls.slice(0, 8).map((c) => `${c.operation} (${c.does}${c.on ? ` ${c.on}` : ""}) at ${c.file}${c.line ? `:${c.line}` : ""}`).join("; ")}${calls.length > 8 ? `; +${calls.length - 8} more` : ""}.`);
  if (spec.states.length) lines.push(`States and options: ${spec.states.map((s) => `${s.of}: ${stateText(s)}`).join("; ")}.`);
  const { core, rest } = coreRules(spec);
  if (core.length) lines.push(`Its core rules: ${core.map((r) => `${r.id} ${r.text} (why: ${r.why})${tag(r.cite, r.by)}`).join("; ")}.${rest ? ` (+${rest} more rule${rest === 1 ? "" : "s"} in the full spec.)` : ""}`);
  if (spec.unknowns?.length) lines.push(`The docs do NOT say — do not assume: ${spec.unknowns.map((u) => `${u.id} ${u.question}${u.mattersFor ? ` (matters for ${u.mattersFor})` : ""}`).join("; ")}.`);
  if (spec.permissions.length) lines.push(`Permissions: ${spec.permissions.map((p) => p.name).join(", ")}.`);
  lines.push(`Full spec with every quote: \`vibegraph-knowledge software show ${spec.tool}\` (or the vibegraph_software tool).`);
  return lines.join("\n");
}

/** The page: every item beside the quote it came from. */
export function formatSpecMd(spec: SoftwareSpec, usage?: { imports: string[]; calls: OperationCall[] }): string {
  const out = [`# ${spec.tool}${spec.vendor ? ` — ${spec.vendor}` : ""}`, "",
    `> Software spec, **${spec.status.toUpperCase()}**${spec.ratifiedAt ? ` ${spec.ratifiedAt.slice(0, 10)}` : ""}. Every item quotes the documents it came from, or says it does not: INFERRED = the drafting model's own; STATED = a person's.`, "",
    `**Role:** ${spec.role}. ${spec.definition} — ${q(spec.definitionCite)}`, "",
    `**Recognised by:** ${[...spec.identity.packages.map((p) => `\`${p}\``), ...spec.identity.calls.slice(0, 12).map((c) => `\`${c}()\``)].join(", ") || "(nothing — it will not be recognised in code)"}`, ""];
  if (spec.operations.length) { out.push("## Operations", ""); for (const o of spec.operations) out.push(`- \`${o.name}\` — ${o.does}${o.on ? ` · ${o.on}` : ""}${o.note ? ` · ${o.note}` : ""} — ${q(o.cite, o.by)}`); out.push(""); }
  if (spec.states.length) { out.push("## States and options", ""); for (const s of spec.states) out.push(`- ${s.of} (${s.kind === "choice" ? "choose one" : "in order"}): ${stateText(s)} — ${q(s.cite, s.by)}`); out.push(""); }
  if (spec.permissions.length) { out.push("## Permissions", ""); for (const p of spec.permissions) out.push(`- \`${p.name}\`${p.for ? ` for ${p.for}` : ""} — ${q(p.cite, p.by)}`); out.push(""); }
  if (spec.rules.length) {
    const { rest } = coreRules(spec);
    out.push("## Rules", "", `**Core** rules are what a hooked session is always told${rest ? `; the other ${rest} are here on demand` : ""}.`, "");
    for (const r of spec.rules) out.push(`- **${r.id}**${r.core ? " *(core)*" : ""} ${r.text} — *why:* ${r.why} — ${q(r.cite, r.by)}${r.check ? ` — check: \`${JSON.stringify(r.check)}\`` : ""}`);
    out.push("");
  }
  if (spec.unknowns?.length) {
    out.push("## What the docs do not say", "", "Open questions — nobody should assume the answer.", "");
    for (const u of spec.unknowns) out.push(`- **${u.id}** ${u.question}${u.mattersFor ? ` — matters for: ${u.mattersFor}` : ""}${u.by === "human" ? " (a person's)" : ""}`);
    out.push("");
  }
  if (usage) {
    out.push("## In this code", "", usage.imports.length ? `Imported in ${usage.imports.join(", ")}.` : "Not imported anywhere.", "");
    for (const c of usage.calls.slice(0, 30)) out.push(`- \`${c.call}\` → ${c.operation} (${c.does}) at ${c.file}${c.line ? `:${c.line}` : ""}`);
    if (usage.calls.length) out.push("");
  }
  out.push("## Sources", "", ...spec.sources.map((s) => `- ${s.ref} (sha256 ${s.sha256.slice(0, 12)}, read ${s.fetched.slice(0, 10)})`), "");
  if (spec.gate && (spec.gate.dropped.length || spec.gate.inferred.length)) {
    out.push("## What the citation gate did", "", ...spec.gate.dropped.map((d) => `- dropped: ${d}`), ...spec.gate.inferred.map((d) => `- inferred: ${d}`), "");
  }
  if (spec.changes?.length) {
    out.push("## Edits since drafting", "", ...spec.changes.map((c) => `- ${c.at.slice(0, 10)} (${c.by}): ${c.change}`), "");
  }
  return out.join("\n");
}

/** `{name}` placeholders still in a check — the project's names it needs. */
export function placeholdersOf(check: unknown): string[] {
  return [...new Set([...JSON.stringify(check ?? null).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

export function fillCheck(check: Record<string, unknown>, params: Record<string, string>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(check).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k].replace(/"/g, "") : m)));
}

/** A spec into plan operations: the tool in the planned stack, and its rules
 *  as planned rules — each cited, all PROPOSED (a person agrees to each). A
 *  rule whose check still needs the project's names keeps them in its text
 *  and carries no check until they are given (`--param name=value`). */
interface PlannedRuleLike { id: string; source?: string; text: string; why: string; check?: Record<string, unknown>; groundedIn?: string | null; status: string }

export function specToPlanOps(
  spec: SoftwareSpec, params: Record<string, string> = {},
  have: { tools: Set<string>; policies: PlannedRuleLike[] } = { tools: new Set(), policies: [] },
): PlanOp[] {
  return specToPlan(spec, params, have).ops;
}

/** The order a spec's rules enter a plan: the chosen ones as given, else the
 *  core rules first, then the rest in the spec's order. */
export function rulesInPlanOrder(spec: SoftwareSpec, only?: string[]): { rules: SoftwareRule[]; unknown: string[] } {
  if (only?.length) {
    const byId = new Map(spec.rules.map((r) => [r.id, r]));
    return { rules: only.filter((id) => byId.has(id)).map((id) => byId.get(id)!), unknown: only.filter((id) => !byId.has(id)) };
  }
  const { core } = coreRules(spec);
  const inCore = new Set(core.map((r) => r.id));
  return { rules: [...core, ...spec.rules.filter((r) => !inCore.has(r.id))], unknown: [] };
}

/** specToPlanOps, plus what did not fit (2026-10-02, from field use: a spec
 *  with 25 rules was refused whole — "policies: 25 items, over the cap of
 *  10" — and nothing entered the plan). New rules are added while the plan
 *  has room under its policies cap, core first; the rest are NAMED, never
 *  dropped silently, and `--rules s1,s4` chooses which. Updates to rules
 *  already in the plan take no room and always apply. */
export function specToPlan(
  spec: SoftwareSpec, params: Record<string, string> = {},
  have: { tools: Set<string>; policies: PlannedRuleLike[] } = { tools: new Set(), policies: [] },
  opts: { rules?: string[] } = {},
): { ops: PlanOp[]; omitted: SoftwareRule[]; unknown: string[]; room: number } {
  const ops: PlanOp[] = [];
  const omitted: SoftwareRule[] = [];
  let room = Math.max(0, PLAN_CAPS.policies - have.policies.filter((p) => p.status !== "dropped").length);
  const { rules, unknown } = rulesInPlanOrder(spec, opts.rules);
  if (!have.tools.has(spec.tool)) {
    ops.push({ op: "add", section: "stack", item: { tool: spec.tool, role: spec.role, why: spec.definition.slice(0, 160), groundedIn: spec.definitionCite, status: "proposed" } });
  }
  const bySource = new Map(have.policies.filter((p) => p.source).map((p) => [p.source!, p]));
  for (const r of rules) {
    const source = `${spec.tool} ${r.id}`;
    const filled = r.check ? fillCheck(r.check, params) : null;
    const was = bySource.get(source);
    // A check the plan already carries, filled with the project's names on an
    // earlier run, is kept when this run was not given them again.
    const kept = was?.check && r.check && filled && placeholdersOf(filled).length ? was.check : undefined;
    const missing = filled && !kept ? placeholdersOf(filled) : [];
    const text = `${r.text}${missing.length ? ` (check needs: ${missing.join(", ")})` : ""}`.slice(0, 240);
    const why = r.why.slice(0, 240);
    const check = kept ?? (filled && !missing.length ? filled : undefined);
    if (!was) {
      if (room <= 0) { omitted.push(r); continue; }
      room--;
      ops.push({ op: "add", section: "policies", item: { text, why, ...(check ? { check } : {}), groundedIn: r.cite, source, status: "proposed" } });
      continue;
    }
    // The spec's rule changed since it entered the plan: bring the planned
    // rule up to date, back to PROPOSED — the person agreed to the old words.
    // A promoted rule lives in constraints.json now, and a dropped one stays dropped.
    if (was.status === "promoted" || was.status === "dropped") continue;
    // A check the person filled in the plan is kept unless the spec now gives one.
    const nextCheck = check ?? (r.check ? was.check : undefined);
    const same = was.text === text && was.why === why && JSON.stringify(was.check ?? null) === JSON.stringify(nextCheck ?? null) && (was.groundedIn ?? null) === r.cite;
    if (!same) ops.push({ op: "update", section: "policies", id: was.id, fields: { text, why, check: nextCheck, groundedIn: r.cite, status: "proposed" } });
  }
  return { ops, omitted, unknown, room };
}
