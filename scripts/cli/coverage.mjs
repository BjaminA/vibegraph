// `vibegraph-knowledge coverage` (2026-09-28) — what VibeGraph knows about
// the files you are about to trust, and what to do first (src/server/
// coverage.ts: parsed? reached? tested? configured? changed since export?).
// Zero tokens, nothing run.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { computeReachability } from "../../src/server/reachability.ts";
import { buildEnvSurface } from "../../src/shared/env_surface.ts";
import { coverageFor } from "../../src/server/coverage.ts";
import { envDeclarations } from "../thread_context.mjs";
import { cliPath } from "./winpath.mjs";

export const COVERAGE_USAGE = `coverage [<root>] <file>… [--json]   per file: parsed fully?, the threads and tests that reach it, the env vars
                                               it reads, changed since the export?, and what to do before trusting it`;

export function runCoverage({ root, files, envelope, pipeline, cache = false }) {
  const absRoot = resolve(cliPath(root));
  const rels = files.map((f) => relative(absRoot, isAbsolute(f) ? f : resolve(process.cwd(), f)).split("\\").join("/"));
  const { envelope: env, parseErrors } = loadEnvelope(absRoot, envelope, pipeline ?? {}, { cache });
  const sourcesPath = join(absRoot, ".vibegraph", "knowledge", "sources.json");
  let exported = null;
  if (existsSync(sourcesPath)) { try { exported = JSON.parse(readFileSync(sourcesPath, "utf-8")); } catch { exported = null; } }
  return coverageFor(rels, {
    env, parseErrors,
    reach: computeReachability(env, { root: absRoot }),
    surface: buildEnvSurface(env, envDeclarations(absRoot)),
    exported,
    readFile: (p) => { try { return readFileSync(join(absRoot, p), "utf-8"); } catch { return null; } },
  });
}
