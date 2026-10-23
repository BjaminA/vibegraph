// Platform-provided variables (2026-10-22, the root-cause handoff RC8: "the
// environment census treats CI and platform variables as project
// configuration"). A synthetic project in Python and TypeScript reads
// GITHUB_ACTIONS, CI, GITHUB_SHA and VERCEL_URL, which a runner or a host sets
// itself, beside MY_API_KEY, which it must be given. Expect only MY_API_KEY
// to be undeclared, and the others said to be provided by their platform.
//
//   npm run test:platform-env
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildEnvSurface } from "../src/shared/env_surface.ts";
import { formatEnvSurfaceMd } from "../src/shared/env_surface_md.ts";
import { platformThatProvides } from "../src/shared/platform_env.ts";
import { envDeclarations } from "../scripts/thread_context.mjs";

const ROOT = "test/fixtures/env/platform_demo";
let surface;
before(() => {
  const env = buildPolyglotEnvelope(ROOT).envelope;
  surface = buildEnvSurface(env, envDeclarations(ROOT));
});

test("only the variable the project must be given is undeclared", () => {
  assert.ok(surface.hasDeclarations, "the compose file declares LOG_LEVEL");
  assert.deepEqual(surface.undeclared, ["MY_API_KEY"]);
});

test("a variable a runner or host sets itself is said to be provided by it", () => {
  const by = Object.fromEntries(surface.vars.map((v) => [v.name, v.providedBy ?? null]));
  assert.deepEqual(by, { CI: "the CI runner", GITHUB_ACTIONS: "GitHub Actions", GITHUB_SHA: "GitHub Actions", LOG_LEVEL: null, MY_API_KEY: null, VERCEL_URL: "Vercel" });
  const md = formatEnvSurfaceMd(surface);
  assert.match(md, /`GITHUB_ACTIONS`[^\n]*provided by GitHub Actions/);
  assert.match(md, /`MY_API_KEY`[^\n]*\*\*nowhere\*\*/);
});

test("a credential is never platform-provided, whatever its prefix", () => {
  for (const name of ["GITHUB_TOKEN", "VERCEL_TOKEN", "NETLIFY_AUTH_TOKEN", "CI_JOB_TOKEN", "RUNNER_SECRET"]) assert.equal(platformThatProvides(name), null, name);
  assert.equal(platformThatProvides("RUNNER_TEMP"), "GitHub Actions");
  assert.equal(platformThatProvides("KUBERNETES_SERVICE_HOST"), "Kubernetes");
  assert.equal(platformThatProvides("CLAUDECODE"), "Claude Code");
  assert.equal(platformThatProvides("API_BASE"), null);
});
