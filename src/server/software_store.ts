// SOFTWARE SPECS on disk (2026-09-30): `.vibegraph/software/<tool>.json`, and
// the source texts their quotes are checked against under
// `.vibegraph/software/sources/`. Validation at the boundary (the file is
// untrusted: a person can edit it), invalid files ignored with a warning.
// Only a RATIFIED spec reaches the stack index, the plan and the hooks.

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type { SoftwareSpec, SoftwareSource } from "../shared/software_types.ts";
import { SOFTWARE_CAPS } from "../shared/software_types.ts";
import { STACK_ROLES } from "../shared/stack_taxonomy.ts";

export const SOFTWARE_DIR = path.join(".vibegraph", "software");
const OP_KINDS = ["read", "write", "call", "subscribe", "admin"];
const TOOL_RE = /^[A-Za-z0-9@][A-Za-z0-9@._/-]{0,60}$/;
const NAME_RE = /^[\w .:/@<>{}\-]{1,80}$/;

const line = (x: unknown, max: number = SOFTWARE_CAPS.line) => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const citeOk = (x: unknown) => x === null || (typeof x === "string" && x.length >= SOFTWARE_CAPS.citeMin && x.length <= SOFTWARE_CAPS.cite);

export function isSafeTool(tool: unknown): tool is string {
  return typeof tool === "string" && TOOL_RE.test(tool) && !tool.includes("..");
}
/** The file name a tool is kept under (a scope's `/` is not a directory). */
export function specFile(tool: string): string {
  return path.join(SOFTWARE_DIR, `${tool.replace(/[@/]/g, (c) => (c === "/" ? "__" : ""))}.json`);
}

/** null when valid, else the reason. */
export function validateSpec(x: unknown): string | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return "a spec must be an object";
  const s = x as Record<string, any>;
  if (s.version !== "1") return `unknown spec version: ${String(s.version)}`;
  if (!isSafeTool(s.tool)) return "tool must be a short name";
  if (!STACK_ROLES.includes(s.role)) return `role must be one of ${STACK_ROLES.join("|")}`;
  if (!line(s.definition, SOFTWARE_CAPS.definition)) return `definition must be one or two sentences (≤ ${SOFTWARE_CAPS.definition})`;
  if (!citeOk(s.definitionCite)) return "definitionCite must be a quote or null";
  if (s.vendor !== undefined && !line(s.vendor, 80)) return "vendor must be a short name";
  if (s.status !== "draft" && s.status !== "ratified") return "status must be draft|ratified";
  const id = s.identity;
  if (!id || !Array.isArray(id.packages) || !Array.isArray(id.calls)) return "identity needs packages and calls";
  if (id.packages.length > SOFTWARE_CAPS.packages || !id.packages.every((p: unknown) => isSafeTool(p))) return "identity.packages must be package names";
  if (id.calls.length > SOFTWARE_CAPS.operations || !id.calls.every((c: unknown) => typeof c === "string" && NAME_RE.test(c))) return "identity.calls must be names";
  const lists: Array<[string, number]> = [["operations", SOFTWARE_CAPS.operations], ["states", SOFTWARE_CAPS.states], ["permissions", SOFTWARE_CAPS.permissions], ["rules", SOFTWARE_CAPS.rules], ["sources", SOFTWARE_CAPS.sources]];
  for (const [k, cap] of lists) {
    if (!Array.isArray(s[k])) return `${k} must be an array`;
    if (s[k].length > cap) return `${k}: ${s[k].length}, over the cap of ${cap}`;
  }
  for (const o of s.operations) {
    if (!o || !NAME_RE.test(String(o.name))) return "an operation needs a name";
    if (!OP_KINDS.includes(o.does)) return `operation ${o.name}: does must be ${OP_KINDS.join("|")}`;
    if (o.on !== undefined && !line(o.on, 80)) return `operation ${o.name}: on must be short`;
    if (o.note !== undefined && !line(o.note)) return `operation ${o.name}: note must be one line`;
    if (!citeOk(o.cite)) return `operation ${o.name}: cite must be a quote (${SOFTWARE_CAPS.citeMin}–${SOFTWARE_CAPS.cite} chars) or null`;
  }
  for (const st of s.states) {
    if (!line(st?.of, 80) || !Array.isArray(st.values) || !st.values.length || !st.values.every((v: unknown) => line(v, 40))) return "a state needs `of` and its values";
    if (!citeOk(st.cite)) return `states of ${st.of}: cite must be a quote or null`;
  }
  for (const p of s.permissions) {
    if (!line(p?.name, 80)) return "a permission needs a name";
    if (!citeOk(p.cite)) return `permission ${p.name}: cite must be a quote or null`;
  }
  const ids = new Set<string>();
  for (const r of s.rules) {
    if (!r || !/^[a-z]\w{0,8}$/.test(String(r.id))) return "a rule needs a short id (s1, s2…)";
    if (ids.has(r.id)) return `duplicate rule ${r.id}`;
    ids.add(r.id);
    if (!line(r.text) || !line(r.why)) return `rule ${r.id}: text and why are required, one line each`;
    if (!citeOk(r.cite)) return `rule ${r.id}: cite must be a quote or null`;
    if (r.check !== undefined && r.check !== null && (typeof r.check !== "object" || typeof r.check.rule !== "string")) return `rule ${r.id}: check must be a constraint-grammar clause or null`;
  }
  for (const src of s.sources) {
    if (!line(src?.ref, 500) || !/^[0-9a-f]{64}$/.test(String(src.sha256)) || !line(src.saved, 200)) return "a source needs ref, sha256 and saved";
  }
  return null;
}

export function loadSpec(root: string, tool: string): SoftwareSpec | null {
  if (!isSafeTool(tool)) return null;
  const file = path.join(root, specFile(tool));
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
  const err = validateSpec(raw);
  if (err) { console.warn(`  [software] ${file} failed validation — ignoring: ${err}`); return null; }
  return raw as SoftwareSpec;
}

export function listSpecs(root: string): SoftwareSpec[] {
  let names: string[] = [];
  try { names = fs.readdirSync(path.join(root, SOFTWARE_DIR)).filter((n) => n.endsWith(".json")); } catch { return []; }
  const out: SoftwareSpec[] = [];
  for (const n of names.sort()) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(root, SOFTWARE_DIR, n), "utf-8"));
      if (!validateSpec(raw)) out.push(raw as SoftwareSpec);
      else console.warn(`  [software] ${n} failed validation — ignoring`);
    } catch { /* unreadable: ignored */ }
  }
  return out;
}

export const ratifiedSpecs = (root: string) => listSpecs(root).filter((s) => s.status === "ratified");

export function saveSpec(root: string, spec: SoftwareSpec): { path?: string; error?: string } {
  const err = validateSpec(spec);
  if (err) return { error: err };
  const file = path.join(root, specFile(spec.tool));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(spec, null, 2) + "\n", "utf-8");
  fs.renameSync(`${file}.tmp`, file);
  return { path: file };
}

export function removeSpec(root: string, tool: string): boolean {
  if (!isSafeTool(tool)) return false;
  const file = path.join(root, specFile(tool));
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Keep a source's text beside the spec, so every quote stays checkable. */
export function saveSource(root: string, tool: string, ref: string, text: string, now: Date = new Date()): SoftwareSource {
  const hash = sha256(text);
  const rel = path.join("sources", `${tool.replace(/[@/]/g, "_")}-${hash.slice(0, 12)}.txt`);
  const file = path.join(root, SOFTWARE_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf-8");
  return { ref, sha256: hash, fetched: now.toISOString(), saved: rel };
}

export function readSources(root: string, spec: SoftwareSpec): Array<{ ref: string; text: string | null }> {
  return spec.sources.map((s) => {
    try { return { ref: s.ref, text: fs.readFileSync(path.join(root, SOFTWARE_DIR, s.saved), "utf-8") }; } catch { return { ref: s.ref, text: null }; }
  });
}
