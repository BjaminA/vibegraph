// The INSIGHT sibling of the project envelope (2026-09-28): what the export
// and the CLI already say in files — reachability, the configuration surface,
// freshness against the last export — shipped to the webview so the GUI can
// show it (thread chips, the code-view gutter, the files panel, the
// architecture map's Configuration lens). One computation per derived pass;
// nothing here is new analysis, only a projection of reachability.ts,
// env_surface.ts and coverage.ts's hash.

import * as fs from "fs";
import * as path from "path";
import { computeReachability } from "./reachability.ts";
import { sha1 } from "./coverage.ts";
import type { EnvSurface } from "../shared/env_surface.ts";
import type { InsightRecord } from "../shared/protocol.ts";

export function buildInsight(
  root: string | null,
  env: { files: Record<string, any>; threads: any[]; entryPoints: any[] },
  envSurface: EnvSurface | null,
): InsightRecord {
  const r = computeReachability(env);
  let freshness: InsightRecord["freshness"] = { exported: false, changed: [] };
  if (root) {
    const p = path.join(root, ".vibegraph", "knowledge", "sources.json");
    try {
      if (fs.existsSync(p)) {
        const recorded = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, string>;
        const changed: string[] = [];
        for (const rel of Object.keys(env.files)) {
          let now: string | null = null;
          try { now = sha1(fs.readFileSync(path.join(root, rel), "utf-8")); } catch { now = null; }
          if (recorded[rel] === undefined || now === null || recorded[rel] !== now) changed.push(rel);
        }
        freshness = { exported: true, changed: changed.sort() };
      }
    } catch { /* an unreadable sources.json reads as no export */ }
  }
  return {
    reachability: {
      defs: r.defs, reached: r.reached,
      unreached: r.unreached.map((u) => ({ file: u.file, id: u.id, name: u.name, line: u.line, reason: u.reason })),
      filesUnreached: r.filesUnreached,
    },
    env: envSurface
      ? {
        vars: envSurface.vars.map((v) => ({
          name: v.name, declared: v.declared.length > 0, threads: v.threads,
          readers: v.readers.map((x) => ({ file: x.file, line: x.line, fnId: x.fnId })),
        })),
        undeclared: envSurface.undeclared,
        byThread: envSurface.byThread,
        hasDeclarations: envSurface.hasDeclarations,
      }
      : null,
    freshness,
  };
}
