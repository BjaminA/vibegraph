// Reading a GitHub repository's docs for a software spec (2026-10-22, Ben:
// "lets employ a permission grant to enable vibegraph to look at used githubs
// in a project / why isnt this automatic as my claude ... has my github
// access"). Claude Code reaches a private repository because it runs `gh` or
// `git` AS the person; VibeGraph fetched the page with no credentials, and a
// private repository answers 404.
//
// A repository link is read through GitHub's API: its README, or the file a
// blob link names, as raw text (the page itself is mostly navigation). A
// PRIVATE repository needs the person's GitHub login, which VibeGraph never
// uses unasked: a person GRANTS it per owner (an organisation or a user), per
// project, kept under ~/.cache and never in the project. The token comes from
// GITHUB_TOKEN / GH_TOKEN or `gh auth token`, is read only when a granted
// owner's repository is read, goes only to api.github.com, and is never
// stored, printed or sent to a model.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDirFor } from "../../scripts/cache_dir.mjs";

/** `path`: a file (a blob link); `dir`: a folder whose README is read (a tree link) */
export interface GithubRef { owner: string; repo: string; path?: string; dir?: string; ref?: string }
export interface DocsRead { text?: string; error?: string; needs?: { github: string } }
export type GithubLogin = { token: string; via: string } | null;

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_BYTES = 5 * 1024 * 1024;

export const validGithubOwner = (s: unknown): s is string => typeof s === "string" && OWNER.test(s);

/** A github.com repository (or file) link, or null. */
export function githubRef(url: string): GithubRef | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const [owner, rawRepo, kind, ref, ...rest] = u.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo)) return null;
  if (rest.some((s) => s === ".." || s === ".")) return null;
  if (kind === "blob" && ref && rest.length) return { owner, repo, ref, path: rest.join("/") };
  // a monorepo package's folder (software_candidates.ts repoUrl): its README
  if (kind === "tree" && ref && rest.length) return { owner, repo, ...(ref !== "HEAD" ? { ref } : {}), dir: rest.join("/") };
  return { owner, repo };
}

// ── the grant: per person, per project, per owner ──
interface Grants { github: Record<string, { at: string }> }
const grantsFile = (root: string) => join(cacheDirFor(root), "grants.json");

export function loadGrants(root: string): Grants {
  try {
    const raw = JSON.parse(readFileSync(grantsFile(root), "utf-8"));
    return { github: raw && typeof raw.github === "object" && raw.github ? raw.github : {} };
  } catch { return { github: {} }; }
}

export function githubGranted(root: string, owner: string): boolean {
  const g = loadGrants(root).github;
  return Object.keys(g).some((o) => o.toLowerCase() === owner.toLowerCase());
}

export function grantGithub(root: string, owner: string, now: Date = new Date()): { ok: boolean; error?: string } {
  if (!validGithubOwner(owner)) return { ok: false, error: `"${owner}" is not a GitHub user or organisation name` };
  const g = loadGrants(root);
  g.github[owner] = { at: now.toISOString() };
  const f = grantsFile(root);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(g, null, 2) + "\n");
  return { ok: true };
}

export function revokeGithub(root: string, owner: string): boolean {
  const g = loadGrants(root);
  const key = Object.keys(g.github).find((o) => o.toLowerCase() === owner.toLowerCase());
  if (!key) return false;
  delete g.github[key];
  writeFileSync(grantsFile(root), JSON.stringify(g, null, 2) + "\n");
  return true;
}

/** The person's GitHub login, if this machine has one: never stored. */
export function githubLogin(env: NodeJS.ProcessEnv = process.env): GithubLogin {
  const t = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  if (t) return { token: t, via: env.GITHUB_TOKEN?.trim() ? "GITHUB_TOKEN" : "GH_TOKEN" };
  try {
    const r = spawnSync("gh", ["auth", "token"], { encoding: "utf-8", timeout: 5000 });
    const token = r.status === 0 ? r.stdout.trim() : "";
    return token ? { token, via: "gh" } : null;
  } catch { return null; }
}

/** The repository's README (or the linked file) as text, through GitHub's API. */
export async function readGithubDocs(ref: GithubRef, opts: { root?: string; login?: () => GithubLogin; fetchImpl?: typeof fetch } = {}): Promise<DocsRead> {
  const name = `github.com/${ref.owner}/${ref.repo}${ref.dir ? `/${ref.dir}` : ""}`;
  const seg = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const api = ref.path ? `${base}/contents/${seg(ref.path)}?ref=${encodeURIComponent(ref.ref ?? "")}`
    : ref.dir ? `${base}/readme/${seg(ref.dir)}${ref.ref ? `?ref=${encodeURIComponent(ref.ref)}` : ""}`
      : `${base}/readme`;
  const granted = !!opts.root && githubGranted(opts.root, ref.owner);
  const login = granted ? (opts.login ?? githubLogin)() : null;
  const headers: Record<string, string> = { accept: "application/vnd.github.raw", "user-agent": "vibegraph-knowledge (software spec)", "x-github-api-version": "2022-11-28" };
  if (login) headers.authorization = `Bearer ${login.token}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(api, { headers, redirect: "follow", signal: ctl.signal });
    if (res.ok) {
      const text = await res.text();
      return text.length > MAX_BYTES ? { error: `${name}: over ${MAX_BYTES / 1024 / 1024} MB` } : { text };
    }
    if ([401, 403, 404].includes(res.status)) {
      if (!granted) return { needs: { github: ref.owner }, error: `${name}: not found without your GitHub login, so it may be private. Allow VibeGraph to read ${ref.owner}'s repositories with your GitHub login: the setup guide's "Use my GitHub login", or \`vibegraph-knowledge setup grant github ${ref.owner}\`` };
      if (!login) return { error: `${name}: your GitHub login is allowed for ${ref.owner}, but none was found here: run \`gh auth login\`, or set GITHUB_TOKEN` };
      return { error: `${name}: not found with your GitHub login (${login.via}) either (HTTP ${res.status}): check the link, and that your account can see it` };
    }
    return { error: `${name}: HTTP ${res.status}` };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return { error: `${name}: ${err.name === "AbortError" ? "timed out" : err.message}` };
  } finally { clearTimeout(timer); }
}
