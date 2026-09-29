// Coverage (2026-09-28) — what VibeGraph knows about the files an agent is
// about to trust, and what to do before trusting it. From the
// codebase-memory-mcp comparison: its per-path `check_index_coverage` (status,
// freshness, a recommended action, and "no recorded gap is not proof") was the
// idea worth taking; this is it over our own facts:
//
//   parsed?     in the IR fully, partially (`degraded`), failed, or never read;
//   reached?    the threads that walk the file, and how many of its functions
//               are on one (reachability.ts gives the rest their reason);
//   tested?     the discovered tests that reach it (test_reach.ts);
//   configured? the environment variables it reads (env_surface.ts);
//   fresh?      whether it changed since the knowledge export was written
//               (the export's sources.json).
//
// Every answer is best-effort and says so: a clean result means nothing was
// RECORDED against the file, never that the file is fully understood.

import { createHash } from "node:crypto";
import type { Reachability } from "./reachability.ts";
import type { EnvSurface } from "../shared/env_surface.ts";

export type CoverageStatus = "parsed" | "partial" | "parse-error" | "not-parsed";

export interface PathCoverage {
  path: string;
  status: CoverageStatus;
  language: string | null;
  dropped?: number;
  threads: string[];
  functions: { defs: number; reached: number };
  /** functions in this file no thread reaches, with the reason. */
  unreached: Array<{ name: string; line: number; reason: string }>;
  tests: string[];
  envVars: string[];
  /** true / false against the export's sources.json; null when there is no export to compare with. */
  changedSinceExport: boolean | null;
  action: string;
}

interface EnvLike {
  files: Record<string, { language?: string; degraded?: { dropped?: number }; nodes?: Array<{ type?: string }> }>;
  threads: ReadonlyArray<{ entryPointId?: string | null; nodes: ReadonlyArray<{ file?: string | null }>; filesReached?: ReadonlyArray<string> }>;
  entryPoints: ReadonlyArray<{ id: string; kind?: string }>;
}

export interface CoverageInputs {
  env: EnvLike;
  parseErrors?: Record<string, string>;
  reach: Reachability;
  surface: EnvSurface | null;
  /** the export's recorded hashes, path → sha1; null when there is no export. */
  exported: Record<string, string> | null;
  /** the current file's contents, or null when it cannot be read. */
  readFile: (path: string) => string | null;
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export function coverageFor(paths: ReadonlyArray<string>, inp: CoverageInputs): PathCoverage[] {
  const tests = new Set(inp.env.entryPoints.filter((e) => e.kind === "test").map((e) => e.id));
  return paths.map((path) => {
    const ir = inp.env.files[path];
    const threads = new Set<string>();
    for (const t of inp.env.threads) {
      if (!t.entryPointId) continue;
      if ((t.filesReached ?? []).includes(path) || t.nodes.some((n) => n.file === path)) threads.add(t.entryPointId);
    }
    const all = [...threads].sort();
    const unreached = inp.reach.unreached.filter((u) => u.file === path);
    const defs = (ir?.nodes ?? []).filter((n) => n.type === "function_def").length;
    const status: CoverageStatus = inp.parseErrors?.[path] ? "parse-error" : !ir ? "not-parsed" : ir.degraded ? "partial" : "parsed";
    const current = inp.readFile(path);
    const changedSinceExport = inp.exported
      ? (inp.exported[path] === undefined ? true : current === null ? null : inp.exported[path] !== sha1(current))
      : null;
    const envVars = (inp.surface?.vars ?? []).filter((v) => v.readers.some((r) => r.file === path)).map((v) => v.name);
    const cov: PathCoverage = {
      path, status, language: ir?.language ?? null,
      ...(ir?.degraded?.dropped ? { dropped: ir.degraded.dropped } : {}),
      threads: all.filter((t) => !tests.has(t)),
      functions: { defs, reached: defs - unreached.length },
      unreached: unreached.map((u) => ({ name: u.name, line: u.line, reason: u.reason })),
      tests: all.filter((t) => tests.has(t)),
      envVars,
      changedSinceExport,
      action: "",
    };
    cov.action = actionFor(cov, current !== null);
    return cov;
  });
}

function actionFor(c: PathCoverage, exists: boolean): string {
  if (!exists && c.status === "not-parsed") return "no such file in the project";
  if (c.status === "not-parsed") return "not parsed (its language is not registered, or its directory is skipped): nothing here describes it — read the source";
  if (c.status === "parse-error") return "the parser failed on it: nothing here describes it — read the source";
  if (c.status === "partial") return `partially read (${c.dropped} construct(s) dropped): read the source before trusting its contract`;
  if (c.changedSinceExport) return "changed since the knowledge export: re-run `export`, or read the source — the contracts describe the old file";
  if (!c.threads.length && !c.tests.length) return "no entry point reaches this file: check reachability.md before editing or deleting anything in it";
  return "covered: the contracts of the threads above describe it (no recorded gap — not proof of completeness)";
}

export function formatCoverage(rows: PathCoverage[]): string {
  const lines: string[] = [];
  for (const c of rows) {
    lines.push(`${c.path}  [${c.status}${c.language ? `, ${c.language}` : ""}]`);
    lines.push(`  action: ${c.action}`);
    if (c.status === "parsed" || c.status === "partial") {
      lines.push(`  threads: ${c.threads.length ? c.threads.join(", ") : "none"}`);
      lines.push(`  functions: ${c.functions.reached} of ${c.functions.defs} on a thread${c.unreached.length ? ` — unreached: ${c.unreached.map((u) => `${u.name}:${u.line} (${u.reason})`).join(", ")}` : ""}`);
      lines.push(`  tests: ${c.tests.length ? c.tests.join(", ") : "no discovered test reaches it"}`);
      if (c.envVars.length) lines.push(`  reads env: ${c.envVars.join(", ")}`);
    }
    lines.push(`  changed since export: ${c.changedSinceExport === null ? "no export to compare with" : c.changedSinceExport ? "YES" : "no"}`);
    lines.push("");
  }
  lines.push("Best-effort: a clean result means nothing is RECORDED against a file, not that it is fully understood.");
  return lines.join("\n") + "\n";
}
