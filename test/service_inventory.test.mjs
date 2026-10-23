// The external-service inventory (2026-10-22, the root-cause handoff RC3:
// "process boundaries stop at subprocess, so services behind CLIs, constants
// and configs vanish"). A synthetic project reaching services every way the
// handoff names, in Python, TypeScript and bash: a program run by a literal,
// a `which()` lookup and an env default; a URL in a constant and in an env
// default; a credential; a wrangler deploy file and a workflow.
//
//   npm run test:service-inventory
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { processLaunches, programOf } from "../src/server/process_launches.ts";
import { buildServiceInventory, servicesNamedWithout } from "../src/server/service_inventory.ts";
import { attributeBoundary } from "../src/shared/stack_attribution.ts";
import { readInfraManifests } from "../src/server/infra_manifests.ts";
import { buildProposePrompt, parseProposal } from "../src/server/arch_propose.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SVC = "test/fixtures/services/svc_demo";
let env, stack, inv;
before(() => { env = buildPolyglotEnvelope(SVC).envelope; stack = buildStackIndex(env, SVC); inv = buildServiceInventory(env, stack, SVC); });
const tmp = mkdtempSync(join(tmpdir(), "vg-svc-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const byName = (n) => inv.services.find((s) => s.name === n);
const sorted = (xs) => [...xs].sort();

test("a launch's program is resolved from a literal, a which() lookup or an env default; an interpreter is not a program", () => {
  const got = processLaunches(env).map((l) => `${l.file}:${l.line} ${l.executable} ${l.from}${l.launch ? ` launched at ${l.launch.line}` : ""}`).sort();
  assert.deepEqual(got, [
    "scripts/publish.ts:6 gh literal", "scripts/publish.ts:7 git literal",
    "tools/fetcher.py:11 pagefetch which",
    "tools/report.py:10 pagerender which",
    "tools/run_helpers.py:10 gh caller launched at 6", "tools/run_helpers.py:14 git caller launched at 6",
    "tools/sync.py:13 gh literal", "tools/sync.py:18 git which", "tools/sync.py:22 pagemaker env-default",
  ]);
  assert.equal(programOf("/usr/local/bin/gh"), "gh");
  assert.equal(programOf("python3"), null);
  assert.equal(programOf("./scripts/run.sh"), null, "a project script is a command crossing, not a program");
});

test("a Python or TypeScript launch leaves through its program, not through subprocess", () => {
  const roles = Object.fromEntries(stack.tools.map((t) => [t.tool, t.role]));
  assert.equal(roles.gh, "platform");
  assert.equal(roles.git, "remote");
  assert.equal(roles.pagemaker, "unknown", "a program no table knows is still a program");
  const at = (file, nodeId, label) => attributeBoundary({ language: file.endsWith(".py") ? "python" : "jsts", label, kind: "external", qualifiedTarget: label, effectKind: "subprocess", file, irNodeId: nodeId, imports: stack.importsByFile?.[file], stack });
  assert.equal(at("tools/sync.py", "module/pull.fn/subprocess_run.call", "subprocess.run").tool, "git");
  assert.equal(at("tools/sync.py", "module/list_releases.fn/out.assign", "subprocess.run").tool, "gh");
  assert.equal(at("scripts/publish.ts", "module/publish.fn/execFileSync.call", "execFileSync").tool, "gh");
  // `self.binary`, set from the constructor's parameter, filled by `which("pagefetch")` in another file
  assert.equal(at("tools/fetcher.py", "module/PageFetcher.class/fetch.fn/return@0", "subprocess.run").tool, "pagefetch");
  // a helper whose callers run gh and git decides nothing at its own launch: the callers carry the programs
  assert.equal(at("tools/run_helpers.py", "module/sh.fn/return@0", "subprocess.run").tool, "subprocess");
});

test("the inventory names each service with its evidence and what it is reached through", () => {
  assert.deepEqual(sorted(byName("GitHub").via), [".github/workflows/deploy.yml", "gh"]);
  assert.deepEqual(byName("GitHub").evidence.filter((e) => e.kind === "program").map((e) => e.file).sort(), ["scripts/publish.ts", "tools/run_helpers.py", "tools/sync.py"]);
  assert.deepEqual(byName("api.example.com").via, ["urllib"], "a URL held in a constant reaches its request");
  assert.deepEqual(sorted(byName("OpenAI").via), ["OPENAI_API_KEY", "urllib"], "an env default's URL, and the credential");
  assert.deepEqual(sorted(byName("Stripe").via), ["STRIPE_SECRET_KEY", "fetch"]);
  assert.deepEqual(byName("AWS").via, ["aws"], "a shell script's command word");
  const cf = byName("Cloudflare");
  assert.ok(cf.via.includes("wrangler.toml") && cf.files.includes("edge/worker.js"), JSON.stringify(cf));
  assert.ok(byName("GitHub Actions"));
  assert.deepEqual(inv.programs.map((p) => p.name), ["aws", "gh", "git", "pagefetch", "pagemaker", "pagerender"]);
});

test("a label naming a service its node has no evidence for is refused; one naming what it reaches is kept", () => {
  assert.deepEqual(servicesNamedWithout("urllib (GitHub API transport)", { id: "tool:urllib", tool: "urllib" }, inv), ["GitHub"]);
  assert.deepEqual(servicesNamedWithout("urllib (pagemaker fetches)", { id: "tool:urllib", tool: "urllib" }, inv), ["pagemaker"]);
  assert.deepEqual(servicesNamedWithout("urllib (OpenAI, api.example.com)", { id: "tool:urllib", tool: "urllib" }, inv), []);
  assert.deepEqual(servicesNamedWithout("gh (GitHub CLI)", { id: "tool:gh", tool: "gh" }, inv), []);
  const model = { nodes: [{ id: "tool:urllib", kind: "tool", label: "urllib", tool: "urllib" }, { id: "tool:gh", kind: "tool", label: "gh", tool: "gh" }], edges: [], groups: [] };
  const reply = JSON.stringify({ groups: [], names: { "tool:urllib": { label: "urllib (GitHub API transport)", evidence: [] }, "tool:gh": { label: "gh (GitHub CLI)", evidence: [] } } });
  const p = parseProposal(reply, model, [], [], { model: "test", services: inv }).proposal;
  assert.deepEqual(Object.keys(p.names), ["tool:gh"]);
  assert.match(p.refused.find((r) => r.item === "name tool:urllib").reason, /names GitHub, which no evidence reaches through urllib/);
  const prompt = buildProposePrompt(model, [], [], undefined, { services: inv });
  assert.ok(prompt.includes("## External services, from evidence"));
  assert.ok(prompt.split("\n").some((l) => l.startsWith("- GitHub: through ") && / gh[ ,(]/.test(l)), "GitHub through gh");
});

test("workflows and deploy files are read as facts: steps, `run: |` blocks, what a deploy file names", () => {
  const dir = join(tmp, "wf");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), ["jobs:", "  a:", "    steps:", "      - uses: aws-actions/configure-aws-credentials@v4", "      - run: |", "          npm ci", "          gh release list", "      - run: echo done", ""].join("\n"));
  writeFileSync(join(dir, "netlify.toml"), ["[build]", '  command = "npm run build"', '  publish = "dist"', ""].join("\n"));
  const facts = readInfraManifests(dir).facts.map((f) => `${f.file}:${f.line} ${f.kind} ${f.name}${f.detail ? ` ${f.detail}` : ""}`);
  assert.deepEqual(facts, [
    ".github/workflows/ci.yml:4 step uses aws-actions/configure-aws-credentials@v4",
    ".github/workflows/ci.yml:6 step run npm ci", ".github/workflows/ci.yml:7 step run gh release list", ".github/workflows/ci.yml:8 step run echo done",
    "netlify.toml:1 deploy netlify.toml", "netlify.toml:2 deploy netlify.toml command npm run build", "netlify.toml:3 deploy netlify.toml publish dist",
  ]);
  const services = buildServiceInventory({ files: {} }, {}, dir).services.map((s) => s.name).sort();
  assert.deepEqual(services, ["AWS", "GitHub", "GitHub Actions", "Netlify"]);
});

test("`services` prints the inventory and the export writes services.md", () => {
  const proj = join(tmp, "svc");
  cpSync(join(ROOT, SVC), proj, { recursive: true });
  const cli = (args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), ...args],
    { cwd: ROOT, encoding: "utf-8", env: { ...process.env, CLAUDECODE: "", VG_NO_CACHE: "1" } });
  const s = cli(["services", proj]);
  assert.equal(s.status, 0, s.stderr);
  assert.ok(s.stdout.startsWith("# External services in svc"), s.stdout.slice(0, 200));
  assert.ok(s.stdout.includes("- **GitHub** through "), "GitHub listed");
  assert.ok(s.stdout.includes("- `pagemaker`: tools/sync.py:22 (from env-default)"), "an unknown program is still listed");
  const e = cli(["export", proj]);
  assert.equal(e.status, 0, e.stderr);
  assert.ok(readFileSync(join(proj, ".vibegraph", "knowledge", "services.md"), "utf-8").includes("**api.example.com** through urllib"));
});
