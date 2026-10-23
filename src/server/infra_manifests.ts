// M-ARCH.4 (PLAN-M-ARCH.md) — what the DEPLOYMENT says, read deterministically.
//
// The deployment/trust grouping of an architecture (which host, which region,
// which network, which process manager) is not in the code; it is in compose
// files, Dockerfiles, k8s manifests, terraform, pm2 ecosystems, Procfiles,
// systemd units and `.env.example`. This reader turns those into FACTS, one
// per line, each with its file:line — the evidence a model's grouping
// proposal must cite (src/server/arch_propose.ts), and the thing a person
// checks it against.
//
// LINE-ORIENTED on purpose, not a YAML parser: a parser returns a tree with
// the line numbers gone, and a fact without its line is not evidence. What a
// line-oriented read cannot see (anchors, merges, templated values) it does
// not claim. `.env` itself is NEVER read — only the committed example files.

import * as fs from "fs";
import * as path from "path";
import { projectIgnore } from "./project_ignore.ts";

export interface InfraFact {
  file: string;
  line: number;
  kind: "service" | "image" | "port" | "network" | "depends_on" | "command" | "base-image" | "expose"
    | "k8s" | "resource" | "pm2-app" | "process" | "env" | "exec"
    // RC3 (2026-10-22): a platform deploy file and what it runs; a workflow step
    | "deploy" | "step";
  name: string;
  detail?: string;
}

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "target", "venv", ".venv", "__pycache__", ".vibegraph", "coverage"]);
const MAX_FACTS = 400;
const MAX_DEPTH = 5;

/** The deployment manifests under `root` (env_declarations.ts reads them too). */
export function manifestFiles(root: string): string[] { return walk(root); }

function walk(root: string): string[] {
  const out: string[] = [];
  // RC3 (2026-10-22) — what the project's .vibegraphignore names is not its
  // deployment either: an archived copy's deploy files were read as current
  const ig = projectIgnore(root);
  const relOf = (full: string) => path.relative(root, full).split(path.sep).join("/");
  const go = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !(e.name.startsWith(".") && e.name !== ".github") && !ig.skipDir(relOf(full))) go(full, depth + 1);
      } else if (e.isFile() && isManifestName(e.name, full) && !ig.skipFile(relOf(full))) out.push(full);
    }
  };
  go(root, 0);
  return out;
}

function isManifestName(name: string, full: string): boolean {
  if (/^(docker-)?compose[\w.-]*\.ya?ml$/i.test(name)) return true;
  if (/^Dockerfile([.\w-]*)?$/.test(name) || /\.Dockerfile$/.test(name)) return true;
  if (/\.tf$/.test(name)) return true;
  if (/^ecosystem\.config\.[cm]?js$/.test(name)) return true;
  if (name === "Procfile") return true;
  if (/\.service$/.test(name)) return true;
  if (/^\.env\.(example|sample|template)$/.test(name)) return true;
  // RC3 — platform deploy files and CI workflows (the platform that reads each: service_tables.ts DEPLOY_FILES)
  if (/^(wrangler\.(toml|jsonc?)|vercel\.json|netlify\.toml|fly\.toml)$/.test(name)) return true;
  if (/\.ya?ml$/.test(name) && /(^|[\\/])\.github[\\/]workflows[\\/]/.test(full)) return true;
  if (/\.ya?ml$/.test(name) && /(^|[\\/])(k8s|kubernetes|deploy|manifests|helm|charts)([\\/]|$)/.test(full)) return true;
  return false;
}

const indentOf = (s: string) => s.length - s.trimStart().length;
const unq = (s: string) => s.trim().replace(/^["']|["']$/g, "");

function readCompose(rel: string, lines: string[], out: InfraFact[]): void {
  let inServices = false;
  let service: string | null = null;
  let svcIndent = -1;
  let listKey: string | null = null;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) return;
    const ind = indentOf(line);
    const t = line.trim();
    if (ind === 0) { inServices = /^services:\s*$/.test(t); service = null; return; }
    if (!inServices) return;
    const key = /^([\w.-]+):\s*(.*)$/.exec(t);
    if (svcIndent < 0 && key) svcIndent = ind;
    if (ind === svcIndent && key) { service = key[1]; listKey = null; out.push({ file: rel, line: i + 1, kind: "service", name: service }); return; }
    if (!service || ind <= svcIndent) return;
    if (key && ind > svcIndent) {
      const [, k, v] = key;
      listKey = v ? null : k;
      if (k === "image" && v) out.push({ file: rel, line: i + 1, kind: "image", name: service, detail: unq(v) });
      else if ((k === "command" || k === "entrypoint") && v) out.push({ file: rel, line: i + 1, kind: "command", name: service, detail: unq(v).slice(0, 160) });
      else if (k === "build" && v) out.push({ file: rel, line: i + 1, kind: "image", name: service, detail: `build ${unq(v)}` });
      return;
    }
    const item = /^-\s*(.+)$/.exec(t);
    if (item && listKey) {
      const v = unq(item[1]);
      if (listKey === "ports") out.push({ file: rel, line: i + 1, kind: "port", name: service, detail: v });
      else if (listKey === "networks") out.push({ file: rel, line: i + 1, kind: "network", name: service, detail: v });
      else if (listKey === "depends_on") out.push({ file: rel, line: i + 1, kind: "depends_on", name: service, detail: v });
    }
  });
}

function readDockerfile(rel: string, lines: string[], out: InfraFact[]): void {
  lines.forEach((raw, i) => {
    const m = /^\s*(FROM|EXPOSE|CMD|ENTRYPOINT)\s+(.+)$/i.exec(raw);
    if (!m) return;
    const k = m[1].toUpperCase();
    const kind = k === "FROM" ? "base-image" : k === "EXPOSE" ? "expose" : "command";
    out.push({ file: rel, line: i + 1, kind, name: path.basename(rel), detail: m[2].trim().slice(0, 160) });
  });
}

function readK8s(rel: string, lines: string[], out: InfraFact[]): void {
  let kind: string | null = null;
  let inMeta = false;
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (t === "---") { kind = null; inMeta = false; return; }
    const k = /^kind:\s*(\w+)/.exec(raw);
    if (k) { kind = k[1]; return; }
    if (/^metadata:\s*$/.test(raw)) { inMeta = true; return; }
    const n = /^\s{2}name:\s*(.+)$/.exec(raw);
    if (inMeta && kind && n) { out.push({ file: rel, line: i + 1, kind: "k8s", name: unq(n[1]), detail: kind }); inMeta = false; }
  });
}

function readTerraform(rel: string, lines: string[], out: InfraFact[]): void {
  lines.forEach((raw, i) => {
    const m = /^\s*resource\s+"([^"]+)"\s+"([^"]+)"/.exec(raw);
    if (m) out.push({ file: rel, line: i + 1, kind: "resource", name: m[2], detail: m[1] });
  });
}

function readPm2(rel: string, lines: string[], out: InfraFact[]): void {
  let current: string | null = null;
  lines.forEach((raw, i) => {
    const n = /\bname\s*:\s*["'`]([^"'`]+)["'`]/.exec(raw);
    if (n) { current = n[1]; out.push({ file: rel, line: i + 1, kind: "pm2-app", name: current }); }
    const s = /\bscript\s*:\s*["'`]([^"'`]+)["'`]/.exec(raw);
    if (s && current) out.push({ file: rel, line: i + 1, kind: "exec", name: current, detail: s[1] });
  });
}

function readProcfile(rel: string, lines: string[], out: InfraFact[]): void {
  lines.forEach((raw, i) => {
    const m = /^([\w-]+):\s*(.+)$/.exec(raw.trim());
    if (m) out.push({ file: rel, line: i + 1, kind: "process", name: m[1], detail: m[2].slice(0, 160) });
  });
}

function readSystemd(rel: string, lines: string[], out: InfraFact[]): void {
  lines.forEach((raw, i) => {
    const m = /^ExecStart=(.+)$/.exec(raw.trim());
    if (m) out.push({ file: rel, line: i + 1, kind: "exec", name: path.basename(rel, ".service"), detail: m[1].slice(0, 160) });
  });
}

/** RC3 — a platform deploy file: the file itself, and the entry or command it
 *  names (wrangler `main`, Netlify / Vercel / Fly build commands and functions). */
function readDeployFile(rel: string, lines: string[], out: InfraFact[]): void {
  const name = path.basename(rel);
  out.push({ file: rel, line: 1, kind: "deploy", name });
  lines.forEach((raw, i) => {
    const m = /^\s*"?(main|command|functions|publish|dockerfile|build_command|buildCommand|outputDirectory|release_command)"?\s*[:=]\s*"([^"]+)"/.exec(raw);
    if (m) out.push({ file: rel, line: i + 1, kind: "deploy", name, detail: `${m[1]} ${m[2]}`.slice(0, 160) });
  });
}

/** RC3 — a CI workflow's steps: each action it uses and each command it runs. */
function readWorkflow(rel: string, lines: string[], out: InfraFact[]): void {
  let block = -1; // inside a `run: |` block: the indent its lines must exceed
  lines.forEach((raw, i) => {
    if (block >= 0) {
      if (!raw.trim()) return;
      if (indentOf(raw) > block) { out.push({ file: rel, line: i + 1, kind: "step", name: "run", detail: raw.trim().slice(0, 160) }); return; }
      block = -1;
    }
    const uses = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(raw);
    if (uses) { out.push({ file: rel, line: i + 1, kind: "step", name: "uses", detail: uses[1].slice(0, 160) }); return; }
    const run = /^(\s*-?\s*)run:\s*(\S.*)$/.exec(raw);
    if (!run) return;
    if (/^[|>][-+]?\s*$/.test(run[2])) block = indentOf(raw);
    else out.push({ file: rel, line: i + 1, kind: "step", name: "run", detail: run[2].trim().slice(0, 160) });
  });
}

/** Only keys that name WHERE something runs or connects: hosts, URLs,
 *  ports, relays, regions, databases. Example files are committed and
 *  non-secret by convention; the value is kept only when it looks like an
 *  address, never a token. */
const ENV_KEY = /(URL|URI|HOST|PORT|DSN|ENDPOINT|RELAY|REGION|DATABASE|BUCKET|QUEUE|TOPIC|ADDR|DID)/i;
/** 2026-09-24 — keys that name a DIRECTORY (`CACHE_ROOT=./output_cache`):
 *  a shared file store is architecture too (arch_stores.ts). The value is
 *  kept only when it is shaped like a relative path. */
const DIR_KEY = /(_DIR|_ROOT|_PATH|FOLDER|CACHE)$|^(CACHE|DATA|OUTPUT|UPLOAD)/i;
function readEnvExample(rel: string, lines: string[], out: InfraFact[]): void {
  lines.forEach((raw, i) => {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) return;
    const v = unq(m[2]);
    if (!ENV_KEY.test(m[1])) {
      if (DIR_KEY.test(m[1]) && /^(\.{1,2}\/)?[A-Za-z_][\w.-]*(\/[\w.-]+)*\/?$/.test(v)) {
        out.push({ file: rel, line: i + 1, kind: "env", name: m[1], detail: v.slice(0, 120) });
      }
      return;
    }
    const addressLike = /^(https?|wss?|postgres(ql)?|mysql|redis|amqp|grpc|did):/i.test(v) || /^[\w.-]+:\d+$/.test(v) || /^\d+$/.test(v);
    out.push({ file: rel, line: i + 1, kind: "env", name: m[1], ...(addressLike ? { detail: v.slice(0, 120) } : {}) });
  });
}

/** One manifest's facts (RC3: the service inventory reads every deploy file
 *  and workflow this way, so the cap below never drops a platform). */
export function readManifest(root: string, rel: string): InfraFact[] {
  const facts: InfraFact[] = [];
  const full = path.join(root, rel);
  let text: string;
  try {
    if (fs.statSync(full).size > 256 * 1024) return facts;
    text = fs.readFileSync(full, "utf-8");
  } catch { return facts; }
  readInto(rel, text.split(/\r?\n/), path.basename(full), facts);
  return facts;
}

/** Every infrastructure fact under `root`, capped, in file order; `files`
 *  lists every manifest found, past the cap too. */
export function readInfraManifests(root: string): { facts: InfraFact[]; files: string[]; truncated: boolean } {
  const facts: InfraFact[] = [];
  const rels = walk(root).map((full) => path.relative(root, full).split(path.sep).join("/"));
  let truncated = false;
  for (const rel of rels) {
    if (truncated) break;
    facts.push(...readManifest(root, rel));
    if (facts.length > MAX_FACTS) { facts.length = MAX_FACTS; truncated = true; }
  }
  return { facts, files: rels, truncated };
}

function readInto(rel: string, lines: string[], name: string, facts: InfraFact[]): void {
    if (/compose[\w.-]*\.ya?ml$/i.test(name)) readCompose(rel, lines, facts);
    else if (/Dockerfile/.test(name)) readDockerfile(rel, lines, facts);
    else if (/\.tf$/.test(name)) readTerraform(rel, lines, facts);
    else if (/^ecosystem\.config/.test(name)) readPm2(rel, lines, facts);
    else if (name === "Procfile") readProcfile(rel, lines, facts);
    else if (/\.service$/.test(name)) readSystemd(rel, lines, facts);
    else if (/^\.env\./.test(name)) readEnvExample(rel, lines, facts);
    else if (/^(wrangler\.|vercel\.json|netlify\.toml|fly\.toml)/.test(name)) readDeployFile(rel, lines, facts);
    else if (/(^|\/)\.github\/workflows\//.test(rel)) readWorkflow(rel, lines, facts);
    else if (/\.ya?ml$/.test(name)) readK8s(rel, lines, facts);
}

// readEnvDeclarations moved to env_declarations.ts (2026-10-17), which reads
// deploy workflows, Dockerfiles, systemd, pm2 and k8s as well.

export function factCitation(f: InfraFact): string {
  return `${f.file}:${f.line}`;
}
