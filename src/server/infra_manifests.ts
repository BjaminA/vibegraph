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

export interface InfraFact {
  file: string;
  line: number;
  kind: "service" | "image" | "port" | "network" | "depends_on" | "command" | "base-image" | "expose"
    | "k8s" | "resource" | "pm2-app" | "process" | "env" | "exec";
  name: string;
  detail?: string;
}

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "target", "venv", ".venv", "__pycache__", ".vibegraph", "coverage"]);
const MAX_FACTS = 400;
const MAX_DEPTH = 5;

function walk(root: string): string[] {
  const out: string[] = [];
  const go = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !(e.name.startsWith(".") && e.name !== ".github")) go(full, depth + 1);
      } else if (e.isFile() && isManifestName(e.name, full)) out.push(full);
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

/** Every infrastructure fact under `root`, capped, in file order. */
export function readInfraManifests(root: string): { facts: InfraFact[]; files: string[]; truncated: boolean } {
  const facts: InfraFact[] = [];
  const files = walk(root);
  const rels: string[] = [];
  for (const full of files) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    rels.push(rel);
    let text: string;
    try {
      if (fs.statSync(full).size > 256 * 1024) continue;
      text = fs.readFileSync(full, "utf-8");
    } catch { continue; }
    const lines = text.split(/\r?\n/);
    const name = path.basename(full);
    const before = facts.length;
    if (/compose[\w.-]*\.ya?ml$/i.test(name)) readCompose(rel, lines, facts);
    else if (/Dockerfile/.test(name)) readDockerfile(rel, lines, facts);
    else if (/\.tf$/.test(name)) readTerraform(rel, lines, facts);
    else if (/^ecosystem\.config/.test(name)) readPm2(rel, lines, facts);
    else if (name === "Procfile") readProcfile(rel, lines, facts);
    else if (/\.service$/.test(name)) readSystemd(rel, lines, facts);
    else if (/^\.env\./.test(name)) readEnvExample(rel, lines, facts);
    else if (/\.ya?ml$/.test(name)) readK8s(rel, lines, facts);
    if (facts.length > MAX_FACTS) { facts.length = MAX_FACTS; return { facts, files: rels, truncated: true }; }
    void before;
  }
  return { facts, files: rels, truncated: false };
}

export function factCitation(f: InfraFact): string {
  return `${f.file}:${f.line}`;
}
