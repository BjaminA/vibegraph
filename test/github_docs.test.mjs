// A GitHub repository's docs for a software spec (2026-10-22,
// src/server/github_docs.ts): read through GitHub's API, and a PRIVATE one with
// the person's GitHub login only where they granted it, per owner and project.
// The fetch and the login are faked here: no network, no token.
//
//   npm run test:github-docs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { githubGranted, githubRef, grantGithub, readGithubDocs, revokeGithub } from "../src/server/github_docs.ts";
import { runSetup, setupActions } from "../src/server/setup_run.ts";
import { installedReadme, repoUrl } from "../src/server/software_candidates.ts";
import { fetchDocs } from "../src/server/software_add.ts";

let base, root;
before(() => { base = mkdtempSync(join(tmpdir(), "vg-gh-")); process.env.VG_CACHE_DIR = join(base, "cache"); root = join(base, "proj"); mkdirSync(root); });
after(() => { rmSync(base, { recursive: true, force: true }); delete process.env.VG_CACHE_DIR; });

/** A fake fetch: records each request, answers by URL. */
const fakeFetch = (answer) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, headers: init.headers }); const [status, body] = answer(url, init.headers); return { ok: status === 200, status, text: async () => body }; };
  return { f, calls };
};

test("a GitHub link: the repository, a file in it, or not GitHub at all", () => {
  assert.deepEqual(githubRef("https://github.com/acme/ledger"), { owner: "acme", repo: "ledger" });
  assert.deepEqual(githubRef("https://github.com/acme/ledger.git"), { owner: "acme", repo: "ledger" });
  assert.deepEqual(githubRef("https://github.com/acme/ledger/tree/main/docs"), { owner: "acme", repo: "ledger", ref: "main", dir: "docs" });
  assert.deepEqual(githubRef("https://github.com/acme/mono/tree/HEAD/clients/ledger"), { owner: "acme", repo: "mono", dir: "clients/ledger" }, "HEAD = the default branch");
  // a link's dot segments are resolved before it is read: it never leaves the repository
  assert.deepEqual(githubRef("https://github.com/acme/mono/tree/HEAD/../../other/x"), { owner: "acme", repo: "mono" });
  assert.deepEqual(githubRef("https://github.com/acme/ledger/blob/main/docs/api.md"), { owner: "acme", repo: "ledger", ref: "main", path: "docs/api.md" });
  for (const u of ["https://gitlab.com/acme/ledger", "https://github.com/acme", "file:///etc/passwd", "https://github.com/-bad/x", "not a url"]) assert.equal(githubRef(u), null, u);
});

test("a public repository is read through the API, and no login is asked for", async () => {
  let asked = 0;
  const { f, calls } = fakeFetch(() => [200, "# Ledger\nPost entries with postEntry."]);
  const r = await readGithubDocs(githubRef("https://github.com/acme/ledger"), { root, fetchImpl: f, login: () => { asked++; return { token: "t0", via: "gh" }; } });
  assert.equal(r.text, "# Ledger\nPost entries with postEntry.");
  assert.equal(calls[0].url, "https://api.github.com/repos/acme/ledger/readme");
  assert.equal(calls[0].headers.accept, "application/vnd.github.raw");
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(asked, 0, "the login is not even read without a grant");
});

test("a private one says which grant would read it; once granted, the login goes to api.github.com only", async () => {
  const { f, calls } = fakeFetch((url, h) => [h.authorization === "Bearer t1" ? 200 : 404, "# Private SDK"]);
  const ref = githubRef("https://github.com/acme/ledger");
  const before = await readGithubDocs(ref, { root, fetchImpl: f, login: () => ({ token: "t1", via: "gh" }) });
  assert.deepEqual(before.needs, { github: "acme" });
  assert.match(before.error, /may be private.*setup grant github acme/);
  assert.equal(grantGithub(root, "acme").ok, true);
  assert.equal(githubGranted(root, "ACME"), true, "an owner's name is not case-sensitive");
  assert.ok(!existsSync(join(root, ".vibegraph")), "the grant is the person's, kept under the cache, never in the project");
  const after = await readGithubDocs(ref, { root, fetchImpl: f, login: () => ({ token: "t1", via: "gh" }) });
  assert.equal(after.text, "# Private SDK");
  assert.ok(calls.every((c) => c.url.startsWith("https://api.github.com/")));
  assert.equal(calls.at(-1).headers.authorization, "Bearer t1");
  // granted, but no login on this machine
  const none = await readGithubDocs(ref, { root, fetchImpl: f, login: () => null });
  assert.match(none.error, /none was found here: run `gh auth login`/);
  // a file link reads that file at that ref; a folder link, that folder's README
  await readGithubDocs(githubRef("https://github.com/acme/ledger/blob/v2/docs/api.md"), { root, fetchImpl: f, login: () => ({ token: "t1", via: "gh" }) });
  assert.equal(calls.at(-1).url, "https://api.github.com/repos/acme/ledger/contents/docs/api.md?ref=v2");
  await readGithubDocs(githubRef("https://github.com/acme/mono/tree/HEAD/clients/ledger"), { root, fetchImpl: f, login: () => ({ token: "t1", via: "gh" }) });
  assert.equal(calls.at(-1).url, "https://api.github.com/repos/acme/mono/readme/clients/ledger");
  assert.equal(revokeGithub(root, "acme"), true);
  assert.equal(githubGranted(root, "acme"), false);
  assert.equal(grantGithub(root, "../etc").ok, false, "a name, never a path");
});

test("a monorepo package: its own README, installed with it, comes first; its repository link names its folder", async () => {
  // the field case: a private scoped package whose repository root had no
  // README (its folder did), while node_modules held the README all along
  const proj = join(base, "mono");
  const pkg = join(proj, "node_modules", "@acme", "ledger-client");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "README.md"), "# Ledger client\npostEntry(entry) posts one entry.\n");
  assert.equal(installedReadme(proj, "@acme/ledger-client"), "node_modules/@acme/ledger-client/README.md");
  assert.equal(installedReadme(proj, "@acme/none"), null);
  assert.equal(repoUrl({ type: "git", url: "git+https://github.com/acme/mono.git", directory: "clients/ledger" }), "https://github.com/acme/mono/tree/HEAD/clients/ledger");
  assert.equal(repoUrl({ url: "git+https://github.com/acme/mono.git", directory: "../x" }), "https://github.com/acme/mono", "a folder with .. is not followed");
  const read = await fetchDocs("node_modules/@acme/ledger-client/README.md", { root: proj });
  assert.match(read.text, /postEntry\(entry\)/, "read from disk: no network, no login");
  for (const bad of ["node_modules/../package.json", "node_modules/@acme/ledger-client/index.js", "src/README.md"]) {
    assert.ok((await fetchDocs(bad, { root: proj })).error, `${bad}: only an installed README is read from disk`);
  }
  // and the setup's run takes it as the docs
  const state = { steps: [{ id: "software", title: "Software", status: "todo", core: true, facts: [], commands: [], now: { text: "", panel: "setup" } }], next: null, after: null, done: 0, of: 1,
    software: { candidates: [{ name: "acme", packages: ["@acme/ledger-client"], kind: "classified", role: "platform", calledOn: 1, docs: [{ url: "node_modules/@acme/ledger-client/README.md", from: "installed" }] }], more: 0, unclassified: [], commands: [], skipped: [] } };
  const a = setupActions(state).actions.find((x) => x.kind === "software");
  assert.deepEqual([a.urls, a.github], [["node_modules/@acme/ledger-client/README.md"], undefined]);
});

test("the setup run carries the grant a failed step needs, for the guide's button", async () => {
  const state = { steps: [{ id: "software", title: "Software", status: "todo", core: true, facts: [], commands: [], now: { text: "", panel: "setup" } }], next: null, after: null, done: 0, of: 1,
    software: { candidates: [{ name: "acme", packages: ["@acme/ledger"], kind: "classified", role: "platform", calledOn: 1, docs: [{ url: "https://github.com/acme/ledger", from: "package.json" }] }], more: 0, unclassified: [], commands: [], skipped: [] } };
  const r = await runSetup({ state: () => state, classify: async () => ({ ok: true }), groups: async () => ({ ok: true }), brief: async () => ({ ok: true }), rules: async () => ({ ok: true }), census: () => ({ ok: true }), settle: async () => {}, step: () => {},
    software: async () => ({ ok: false, error: "could not read github.com/acme/ledger: not found", needs: { github: "acme" } }) }, { steps: ["software"] });
  assert.deepEqual(r.failed.map((x) => x.needs), [{ github: "acme" }]);
});

test("granting the login is a person's step: refused when Claude Code runs it", () => {
  const cli = (args, env) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", ...args], { encoding: "utf-8", env: { ...process.env, ...env } });
  const refused = cli(["setup", "grant", "github", "acme", root], { CLAUDECODE: "1" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout + refused.stderr, /person's step/);
  assert.equal(githubGranted(root, "acme"), false);
  const ok = cli(["setup", "grant", "github", "acme", root], { CLAUDECODE: "", VG_PERSON_NO_TTY: "1" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(githubGranted(root, "acme"), true);
  assert.equal(cli(["setup", "revoke", "github", "acme", root], { CLAUDECODE: "1" }).status, 0, "taking a grant away is anyone's");
  assert.equal(githubGranted(root, "acme"), false);
});
