// "DECLARED" MEANS "WRITTEN BY SOMETHING THAT REACHES A HOST" (2026-10-17).
// From a field run: the outage was a variable read by the code and written by
// no deploy workflow — present in configuration.md as one of 224 "declared
// nowhere", alphabetical, three lines below a CI secret that was fine, because
// declarations came only from .env.example and compose. Pinned here: the
// deploy-side readers (workflows, Dockerfile, systemd, pm2, k8s), what an
// unset value does at each read in three languages, the ranking, build-time
// names, and two deploy workflows compared.
//
//   npm run test:configuration-deploy
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildFromSource as buildJsts } from "../scripts/frontends/jsts/builder.mjs";
import { buildFromSource as buildBash } from "../scripts/frontends/bash/builder.mjs";
import { buildEnvSurface, configuredByFor, formatConfiguredBy } from "../src/shared/env_surface.ts";
import { formatEnvSurfaceMd } from "../src/shared/env_surface_md.ts";
import { readEnvDeclarations } from "../src/server/env_declarations.ts";

const shapes = (ir) => Object.fromEntries((ir.envReads ?? []).map((r) => [r.name, [r.fallback ?? "-", r.use ?? "-"].join(" ")]));

test("JS/TS: what an unset value does at each read", async () => {
  const { ir } = await buildJsts([
    'const allowed = (process.env.ALLOWED_NAMES || "").split(",").filter(Boolean);',
    'const base = process.env.BASE_URL ?? "http://localhost:3000";',
    "const id = process.env.TENANT_ID.trim();",
    'const tags = process.env.TAGS?.split(",") ?? [];',
    "export function a() { if (!process.env.FEATURE_ON) return null; return 1; }",
    'export function b() { if (!process.env.API_KEY) throw new Error("API_KEY"); }',
    "const plain = process.env.PLAIN;",
    'const { REGION = "eu" } = process.env;',
  ].join("\n"), "m", "ts");
  assert.deepEqual(shapes(ir), {
    ALLOWED_NAMES: "empty split", BASE_URL: "value -", TENANT_ID: "throws -", TAGS: "empty split",
    FEATURE_ON: "- exit-silent", API_KEY: "- exit-loud", PLAIN: "- -", REGION: "value -",
  });
});

test("Python: the same shapes; a subscript raises; `os.environ[X] = v` is a write, not a read", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-envshape-py-"));
  try {
    const f = join(dir, "m.py");
    writeFileSync(f, [
      "import os, sys",
      "A = os.environ['DB_URL']",
      "B = os.environ.get('TOKEN', '')",
      "C = (os.environ.get('ALLOWED') or '').split(',')",
      "D = os.getenv('BASE', 'http://x')",
      "E = os.environ.get('MODE', None)",
      "os.environ['SET_HERE'] = '1'",
      "def f():",
      "    if not os.environ.get('FEATURE'):",
      "        return None",
      "    if not os.getenv('KEY'):",
      "        sys.exit(1)",
      "",
    ].join("\n"));
    const r = spawnSync("python3", ["scripts/parse_cst.py", f], { encoding: "utf-8", env: { ...process.env, PYTHONPATH: ".pydeps" } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(shapes(JSON.parse(r.stdout)), {
      DB_URL: "throws -", TOKEN: "empty -", ALLOWED: "empty split", BASE: "value -", MODE: "- -", FEATURE: "- exit-silent", KEY: "- exit-loud",
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("bash: the expansion operator says it", async () => {
  const { ir } = await buildBash(['#!/bin/bash', 'echo "${A_URL:-http://x}" "${B_LIST:-}" "${C_KEY:?set C_KEY}" "$D_BARE"'].join("\n") + "\n", "m");
  assert.deepEqual(shapes(ir), { A_URL: "value -", B_LIST: "empty -", C_KEY: "throws -", D_BARE: "- -" });
});

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), "vg-deploy-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "deploy-a.yml"), [
    "name: deploy a", "on: push", "jobs:", "  deploy:", "    runs-on: ubuntu-latest",
    "    env:", "      BASE_URL: ${{ vars.BASE_URL }}", "      API_KEY: ${{ secrets.API_KEY }}", "      NEXT_PUBLIC_TENANT: ${{ vars.NEXT_PUBLIC_TENANT }}",
    "    steps:", "      - uses: some/ssh-action@v1", "        with:", "          envs: BASE_URL,API_KEY", "          script: |",
    '            upsert_env "$APP_ENV" BASE_URL "$BASE_URL"', '            docker run -e API_KEY img', '            echo "LOG_LEVEL=info" >> .env',
  ].join("\n") + "\n");
  writeFileSync(join(root, ".github", "workflows", "deploy-b.yml"), [
    "name: deploy b", "on: push", "jobs:", "  deploy:", "    runs-on: ubuntu-latest",
    "    env:", "      BASE_URL: ${{ vars.BASE_URL }}", "      NEXT_PUBLIC_TENANT: ${{ vars.NEXT_PUBLIC_TENANT }}",
    "    steps:", "      - run: |", '          upsert_env "$APP_ENV" BASE_URL "$BASE_URL"',
  ].join("\n") + "\n");
  writeFileSync(join(root, ".github", "workflows", "test.yml"), ["name: test", "jobs:", "  t:", "    env:", "      CI_ONLY: 1", "    steps:", "      - run: npm test"].join("\n") + "\n");
  writeFileSync(join(root, "Dockerfile"), "FROM node:22\nARG BUILD_SHA\nENV PORT=3000 HOST=0.0.0.0\n");
  writeFileSync(join(root, "app.service"), '[Service]\nEnvironment=QUEUE_URL=amqp://x "WORKERS=2"\n');
  writeFileSync(join(root, "ecosystem.config.js"), "module.exports = { apps: [{ name: 'api', env: {\n  NODE_ENV: 'production',\n  CACHE_DIR: '/var/cache',\n} }] };\n");
  mkdirSync(join(root, "k8s"));
  writeFileSync(join(root, "k8s", "api.yaml"), "apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - name: api\n          env:\n            - name: DB_HOST\n              value: db\n");
});
after(() => rmSync(root, { recursive: true, force: true }));

test("declarations from everything that reaches a host — names only, with how and from which store", () => {
  const d = readEnvDeclarations(root);
  const key = (x) => `${x.name}@${x.file}:${x.via}${x.from ? `:${x.from}` : ""}`;
  const got = new Set(d.map(key));
  for (const want of [
    "BASE_URL@.github/workflows/deploy-a.yml:workflow-env:var", "API_KEY@.github/workflows/deploy-a.yml:workflow-env:secret",
    "BASE_URL@.github/workflows/deploy-a.yml:workflow-pass", "API_KEY@.github/workflows/deploy-a.yml:workflow-pass",
    "BASE_URL@.github/workflows/deploy-a.yml:workflow-write", "API_KEY@.github/workflows/deploy-a.yml:workflow-write", "LOG_LEVEL@.github/workflows/deploy-a.yml:workflow-write",
    "BUILD_SHA@Dockerfile:build-arg", "PORT@Dockerfile:dockerfile", "HOST@Dockerfile:dockerfile",
    "QUEUE_URL@app.service:systemd", "WORKERS@app.service:systemd", "NODE_ENV@ecosystem.config.js:pm2", "CACHE_DIR@ecosystem.config.js:pm2", "DB_HOST@k8s/api.yaml:k8s",
  ]) assert.ok(got.has(want), `missing ${want}`);
  assert.ok(!d.some((x) => x.name === "APP_ENV"), "the helper's file argument is not a declaration");
  assert.ok(!JSON.stringify(d).includes("amqp://") && !JSON.stringify(d).includes("/var/cache"), "values are never carried");
});

test("the surface ranks by what an unset value does, marks build-time names, and compares the two deploy workflows", () => {
  const env = {
    files: {
      "page.tsx": { language: "jsts", nodes: [], envReads: [
        { name: "ALLOWED_NAMES", line: 4, form: "member", fallback: "empty", use: "split" },
        { name: "NEXT_PUBLIC_TENANT", line: 5, form: "member" },
        { name: "API_KEY", line: 6, form: "member" },
        { name: "STRICT_KEY", line: 7, form: "member", use: "exit-loud" },
        { name: "PLAIN", line: 8, form: "member" },
        { name: "WITH_DEFAULT", line: 9, form: "member", fallback: "value" },
      ] },
    },
    threads: [{ entryPointId: "page.tsx:module", nodes: [{ kind: "seed", file: "page.tsx", irNodeId: "module" }], filesReached: ["page.tsx"] }],
  };
  const s = buildEnvSurface(env, readEnvDeclarations(root));
  assert.deepEqual(s.undeclared, ["ALLOWED_NAMES", "PLAIN", "STRICT_KEY", "WITH_DEFAULT"], "fails silently first, a default last");
  assert.equal(s.vars.find((v) => v.name === "NEXT_PUBLIC_TENANT").buildTime, true);
  const wf = s.targetGaps.find((g) => g.family === "deploy workflows");
  assert.deepEqual(wf.targets, [".github/workflows/deploy-a.yml", ".github/workflows/deploy-b.yml"], "the CI-only workflow is not a deploy target");
  assert.deepEqual(wf.rows, [{ name: "API_KEY", setIn: [".github/workflows/deploy-a.yml"] }], "set on one, missing on the other");
  const md = formatEnvSurfaceMd(s);
  assert.match(md, /## Read, but set by nothing that reaches a host \(4\)/);
  assert.match(md, /### Fails silently when unset[^\n]*\(1\)\n\n- `ALLOWED_NAMES` — read in `page\.tsx:4` \(empty fallback, split into a list\)/);
  assert.ok(md.indexOf("ALLOWED_NAMES") < md.indexOf("`PLAIN`"));
  assert.match(md, /## Set for some deploy workflows, not others \(1\)/);
  assert.match(md, /\| `API_KEY` \| set \| \*\*missing\*\* \|/);
  assert.match(md, /`NEXT_PUBLIC_TENANT` \(build-time\)/);
  assert.match(formatConfiguredBy(configuredByFor(s, "page.tsx:module")), /`ALLOWED_NAMES` \(NOT declared, fails silently when unset\)/);
});
