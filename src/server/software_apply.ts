// Using a RATIFIED software spec (2026-09-30): where it applies in the code,
// which calls are its operations, what a hooked session is told, how it reads
// as a page, and how it enters a plan. Pure — specs and IR in, text out.

import type { SoftwareSpec, SoftwareRule } from "../shared/software_types.ts";
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

const q = (c: string | null) => (c ? `"${c.length > 90 ? `${c.slice(0, 87)}…` : c}"` : "INFERRED — not in its docs");

/** The compact form a hooked session receives, once per session per spec. */
export function specHeadlines(spec: SoftwareSpec, calls: OperationCall[] = []): string {
  const lines = [`## Software: ${spec.tool}${spec.vendor ? ` (${spec.vendor})` : ""} — ${spec.role}; a ratified spec cited from its own docs`, spec.definition];
  if (calls.length) lines.push(`This code calls it: ${calls.slice(0, 8).map((c) => `${c.operation} (${c.does}${c.on ? ` ${c.on}` : ""}) at ${c.file}${c.line ? `:${c.line}` : ""}`).join("; ")}${calls.length > 8 ? `; +${calls.length - 8} more` : ""}.`);
  if (spec.states.length) lines.push(`States: ${spec.states.map((s) => `${s.of}: ${s.values.join(" → ")}`).join("; ")}.`);
  if (spec.rules.length) lines.push(`Its rules: ${spec.rules.map((r) => `${r.id} ${r.text} (why: ${r.why})${r.cite ? "" : " [inferred]"}`).join("; ")}.`);
  if (spec.permissions.length) lines.push(`Permissions: ${spec.permissions.map((p) => p.name).join(", ")}.`);
  lines.push(`Full spec with every quote: \`vibegraph-knowledge software show ${spec.tool}\` (or the vibegraph_software tool).`);
  return lines.join("\n");
}

/** The page: every item beside the quote it came from. */
export function formatSpecMd(spec: SoftwareSpec, usage?: { imports: string[]; calls: OperationCall[] }): string {
  const out = [`# ${spec.tool}${spec.vendor ? ` — ${spec.vendor}` : ""}`, "",
    `> Software spec, **${spec.status.toUpperCase()}**${spec.ratifiedAt ? ` ${spec.ratifiedAt.slice(0, 10)}` : ""}. Every item quotes the documents it came from; INFERRED items are the drafting model's own and were not in them.`, "",
    `**Role:** ${spec.role}. ${spec.definition} — ${q(spec.definitionCite)}`, "",
    `**Recognised by:** ${[...spec.identity.packages.map((p) => `\`${p}\``), ...spec.identity.calls.slice(0, 12).map((c) => `\`${c}()\``)].join(", ") || "(nothing — it will not be recognised in code)"}`, ""];
  if (spec.operations.length) { out.push("## Operations", ""); for (const o of spec.operations) out.push(`- \`${o.name}\` — ${o.does}${o.on ? ` · ${o.on}` : ""}${o.note ? ` · ${o.note}` : ""} — ${q(o.cite)}`); out.push(""); }
  if (spec.states.length) { out.push("## States", ""); for (const s of spec.states) out.push(`- ${s.of}: ${s.values.join(" → ")} — ${q(s.cite)}`); out.push(""); }
  if (spec.permissions.length) { out.push("## Permissions", ""); for (const p of spec.permissions) out.push(`- \`${p.name}\`${p.for ? ` for ${p.for}` : ""} — ${q(p.cite)}`); out.push(""); }
  if (spec.rules.length) { out.push("## Rules", ""); for (const r of spec.rules) out.push(`- **${r.id}** ${r.text} — *why:* ${r.why} — ${q(r.cite)}${r.check ? ` — check: \`${JSON.stringify(r.check)}\`` : ""}`); out.push(""); }
  if (usage) {
    out.push("## In this code", "", usage.imports.length ? `Imported in ${usage.imports.join(", ")}.` : "Not imported anywhere.", "");
    for (const c of usage.calls.slice(0, 30)) out.push(`- \`${c.call}\` → ${c.operation} (${c.does}) at ${c.file}${c.line ? `:${c.line}` : ""}`);
    if (usage.calls.length) out.push("");
  }
  out.push("## Sources", "", ...spec.sources.map((s) => `- ${s.ref} (sha256 ${s.sha256.slice(0, 12)}, read ${s.fetched.slice(0, 10)})`), "");
  if (spec.gate && (spec.gate.dropped.length || spec.gate.inferred.length)) {
    out.push("## What the citation gate did", "", ...spec.gate.dropped.map((d) => `- dropped: ${d}`), ...spec.gate.inferred.map((d) => `- inferred: ${d}`), "");
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
export function specToPlanOps(spec: SoftwareSpec, params: Record<string, string> = {}, have: { tools: Set<string>; sources: Set<string> } = { tools: new Set(), sources: new Set() }): PlanOp[] {
  const ops: PlanOp[] = [];
  if (!have.tools.has(spec.tool)) {
    ops.push({ op: "add", section: "stack", item: { tool: spec.tool, role: spec.role, why: spec.definition.slice(0, 160), groundedIn: spec.definitionCite, status: "proposed" } });
  }
  for (const r of spec.rules as SoftwareRule[]) {
    const source = `${spec.tool} ${r.id}`;
    if (have.sources.has(source)) continue;
    const filled = r.check ? fillCheck(r.check, params) : null;
    const missing = filled ? placeholdersOf(filled) : [];
    const text = `${r.text}${missing.length ? ` (check needs: ${missing.join(", ")})` : ""}`.slice(0, 240);
    ops.push({ op: "add", section: "policies", item: {
      text, why: r.why.slice(0, 240), ...(filled && !missing.length ? { check: filled } : {}),
      groundedIn: r.cite, source, status: "proposed",
    } });
  }
  return ops;
}
