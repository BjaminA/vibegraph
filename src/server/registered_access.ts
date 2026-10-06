// REGISTERED ACCESS (2026-10-06, direction review M6). Some store names are
// decided at run time where no static rule can follow them — a watcher handed
// a list a model builds, a path assembled from a registry key. A project may
// SAY what such code touches, in `.vibegraph/operations.json`:
//
//   "paths":  { "<helper function>": "<family>" | ["<family>", …] }
//             a call whose name comes from that helper is an operation on it
//   "access": [{ "at": "<file>:<line>", "op": "read|write|watch",
//                "families": ["<family>", …], "why": "<one line>" }]
//             the operation at that line, stated
//
// Both are STATED, never derived: each operation they make says so, with the
// file it came from and the reason. A family no zone answers to is reported,
// never drawn. Validated here; anything malformed is dropped with its reason.

import * as fs from "node:fs";
import * as path from "node:path";

export interface RegisteredAccess {
  paths: Record<string, string[]>;
  access: Array<{ file: string; line: number; op: "read" | "write" | "watch"; families: string[]; why: string }>;
  refused: string[];
}

export const OPERATIONS_FILE = ".vibegraph/operations.json";
const EMPTY: RegisteredAccess = { paths: {}, access: [], refused: [] };
const name = (s: unknown) => typeof s === "string" && /^[^\n]{1,120}$/.test(s);

export function registeredAccess(root: string | null | undefined): RegisteredAccess {
  if (!root) return EMPTY;
  let raw: any;
  try { raw = JSON.parse(fs.readFileSync(path.join(root, OPERATIONS_FILE), "utf-8")); } catch { return EMPTY; }
  return parseRegisteredAccess(raw);
}

export function parseRegisteredAccess(raw: any): RegisteredAccess {
  const out: RegisteredAccess = { paths: {}, access: [], refused: [] };
  for (const [fn, fam] of Object.entries(raw?.paths ?? {}).slice(0, 50)) {
    const fams = (Array.isArray(fam) ? fam : [fam]).filter(name) as string[];
    if (!/^[A-Za-z_$][\w$]*$/.test(fn) || !fams.length) { out.refused.push(`paths.${fn}: a function name and one or more family names`); continue; }
    out.paths[fn] = fams.slice(0, 12);
  }
  for (const [i, a] of (Array.isArray(raw?.access) ? raw.access : []).slice(0, 50).entries()) {
    const m = /^(.+):(\d+)$/.exec(String(a?.at ?? ""));
    const fams = (Array.isArray(a?.families) ? a.families : []).filter(name) as string[];
    if (!m || m[1].includes("..") || !["read", "write", "watch"].includes(a?.op) || !fams.length || !name(a?.why)) {
      out.refused.push(`access[${i}]: needs at "<file>:<line>", op read|write|watch, families, and a one-line why`);
      continue;
    }
    out.access.push({ file: m[1], line: Number(m[2]), op: a.op, families: fams.slice(0, 12), why: a.why });
  }
  return out;
}
