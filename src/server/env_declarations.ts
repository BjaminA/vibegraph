// Every environment variable the project DECLARES — by NAME, never a value —
// from each place that can put one in front of running code (2026-09-28;
// moved out of infra_manifests.ts and widened 2026-10-17).
//
// A field run's outage was a variable the code read and no deploy wrote. It
// was in configuration.md already, one of 224 "declared nowhere", because
// "declared" meant an `.env.example` line or a compose `environment:` key and
// that project declares its environment in GitHub workflows. So "declared"
// now means "written by some path that reaches a host":
//
//   env-template   `KEY=` lines of .env.example / .sample / .template (a
//                  commented `# KEY=` documents an optional one)
//   compose        keys of an `environment:` block
//   dockerfile     `ENV KEY=…` — and `ARG KEY` as build-arg (build time only)
//   systemd        `Environment=KEY=…`
//   pm2            keys of an `env` / `env_<name>` block in ecosystem.config
//   k8s            `- name: KEY` items of an `env:` list
//   workflow-env   keys of a workflow `env:` block (`${{ secrets.X }}` and
//                  `${{ vars.X }}` say which store, as `from`)
//   workflow-pass  names in an `envs:` passthrough list (ssh / deploy actions)
//   workflow-write a run step that writes the variable onward: `KEY=…` sent
//                  to a file (`>>`, `>`, `tee`), `-e KEY` / `--env` /
//                  `--build-arg KEY`, or a helper given the name and its own
//                  value (`upsert_env "$FILE" KEY "$KEY"`)
//   workflow-step  `export KEY=…` / `KEY=…` in a run step (that step only)
//
// LINE-ORIENTED, like infra_manifests.ts: each declaration keeps its
// file:line, and what a line read cannot see (anchors, templated names, a
// value built in a script) it does not claim. `.env` itself is never read.

import * as fs from "fs";
import * as path from "path";
import { manifestFiles } from "./infra_manifests.ts";

export type DeclarationVia = "env-template" | "compose" | "dockerfile" | "build-arg" | "systemd" | "pm2" | "k8s"
  | "workflow-env" | "workflow-pass" | "workflow-write" | "workflow-step";
export interface EnvDeclarationRecord { name: string; file: string; line: number; via: DeclarationVia; from?: "secret" | "var" }

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UPPER_KEY = "[A-Z][A-Z0-9_]*";

function readLines(full: string): string[] | null {
  try {
    if (fs.statSync(full).size > 256 * 1024) return null;
    return fs.readFileSync(full, "utf-8").split(/\r?\n/);
  } catch { return null; }
}
const indentOf = (s: string) => s.length - s.trimStart().length;

/** The keys under a YAML `<key>:` block (mapping or `- name:` list), with their lines. */
function yamlBlockKeys(lines: string[], key: RegExp, item: RegExp): Array<{ name: string; line: number; raw: string }> {
  const out: Array<{ name: string; line: number; raw: string }> = [];
  let blockIndent = -1;
  lines.forEach((raw, i) => {
    if (key.test(raw)) { blockIndent = indentOf(raw); return; }
    if (blockIndent < 0 || !raw.trim() || raw.trim().startsWith("#")) return;
    if (indentOf(raw) <= blockIndent) { blockIndent = -1; return; }
    const m = item.exec(raw);
    if (m && KEY.test(m[1])) out.push({ name: m[1], line: i + 1, raw });
  });
  return out;
}

function readWorkflow(rel: string, lines: string[], out: EnvDeclarationRecord[]): void {
  for (const k of yamlBlockKeys(lines, /^\s*env:\s*$/, /^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:/)) {
    const from = /\$\{\{\s*secrets\./.test(k.raw) ? "secret" : /\$\{\{\s*vars\./.test(k.raw) ? "var" : undefined;
    out.push({ name: k.name, file: rel, line: k.line, via: "workflow-env", ...(from ? { from } as const : {}) });
  }
  lines.forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t || t.startsWith("#")) return;
    // `envs: A,B,C` (and a block scalar continuing on the lines below)
    const envs = /^\s*envs:\s*(.*)$/.exec(raw);
    if (envs) {
      let list = envs[1].trim();
      if (/^[|>][-+]?$/.test(list)) {
        list = "";
        for (let j = i + 1; j < lines.length && (indentOf(lines[j]) > indentOf(raw) || !lines[j].trim()); j++) list += ` ${lines[j].trim()}`;
      }
      for (const n of list.replace(/^["']|["']$/g, "").split(/[\s,]+/)) if (KEY.test(n)) out.push({ name: n, file: rel, line, via: "workflow-pass" });
      return;
    }
    const seen = new Set<string>();
    const add = (name: string, via: DeclarationVia) => { if (!seen.has(name)) { seen.add(name); out.push({ name, file: rel, line, via }); } };
    if (/>>?|\btee\b/.test(raw)) for (const m of raw.matchAll(new RegExp(`(?<![\\w$])(${UPPER_KEY})=`, "g"))) add(m[1], "workflow-write");
    for (const m of raw.matchAll(new RegExp(`(?:^|\\s)(?:-e|--env|--build-arg)\\s+["']?(${UPPER_KEY})(?=[="'\\s]|$)`, "g"))) add(m[1], "workflow-write");
    // a helper given the name and its own value: `upsert_env "$F" KEY "$KEY"` / `set KEY "${{ secrets.KEY }}"`
    for (const m of raw.matchAll(new RegExp(`(?<![\\w$])(${UPPER_KEY})\\s+["']?\\$\\{?(?:\\{\\s*(?:secrets|vars)\\.)?(${UPPER_KEY})\\b`, "g"))) if (m[1] === m[2]) add(m[1], "workflow-write");
    const step = new RegExp(`^\\s*(?:-\\s+)?(?:export\\s+)?(${UPPER_KEY})=`).exec(raw);
    if (step && !/:\s/.test(raw.split("=")[0])) add(step[1], "workflow-step");
  });
}

function workflowFiles(root: string): string[] {
  const dir = path.join(root, ".github", "workflows");
  try { return fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => path.join(dir, f)); } catch { return []; }
}

export function readEnvDeclarations(root: string): EnvDeclarationRecord[] {
  const out: EnvDeclarationRecord[] = [];
  const rel = (full: string) => path.relative(root, full).split(path.sep).join("/");
  for (const full of manifestFiles(root)) {
    const name = path.basename(full);
    const lines = readLines(full);
    if (!lines) continue;
    const file = rel(full);
    if (/^\.env\./.test(name)) {
      lines.forEach((raw, i) => {
        const m = /^\s*#?\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(raw);
        if (m) out.push({ name: m[1], file, line: i + 1, via: "env-template" });
      });
    } else if (/compose[\w.-]*\.ya?ml$/i.test(name)) {
      for (const k of yamlBlockKeys(lines, /^\s*environment:\s*$/, /^\s*-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[:=]/)) out.push({ name: k.name, file, line: k.line, via: "compose" });
    } else if (/Dockerfile/.test(name)) {
      lines.forEach((raw, i) => {
        const env = /^\s*ENV\s+(.+)$/i.exec(raw);
        if (env) {
          const names = env[1].includes("=") ? [...env[1].matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g)].map((m) => m[1]) : [env[1].trim().split(/\s+/)[0]];
          for (const n of names) if (KEY.test(n)) out.push({ name: n, file, line: i + 1, via: "dockerfile" });
        }
        const arg = /^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(raw);
        if (arg) out.push({ name: arg[1], file, line: i + 1, via: "build-arg" });
      });
    } else if (/\.service$/.test(name)) {
      lines.forEach((raw, i) => {
        const m = /^\s*Environment=(.+)$/.exec(raw);
        if (m) for (const e of m[1].matchAll(/(?:^|\s)"?([A-Za-z_][A-Za-z0-9_]*)=/g)) out.push({ name: e[1], file, line: i + 1, via: "systemd" });
      });
    } else if (/^ecosystem\.config/.test(name)) {
      let depth = 0;
      lines.forEach((raw, i) => {
        if (depth === 0 && /\benv(?:_\w+)?\s*:\s*\{/.test(raw)) { depth = 1; return; }
        if (depth === 0) return;
        const m = /^\s*["']?([A-Z][A-Z0-9_]*)["']?\s*:/.exec(raw);
        if (m && depth === 1) out.push({ name: m[1], file, line: i + 1, via: "pm2" });
        depth += (raw.match(/\{/g) ?? []).length - (raw.match(/\}/g) ?? []).length;
        if (depth < 1) depth = 0;
      });
    } else if (/\.ya?ml$/.test(name)) {
      for (const k of yamlBlockKeys(lines, /^\s*env:\s*$/, /^\s*-\s*name:\s*["']?([A-Za-z_][A-Za-z0-9_]*)/)) out.push({ name: k.name, file, line: k.line, via: "k8s" });
    }
  }
  for (const full of workflowFiles(root)) {
    const lines = readLines(full);
    if (lines) readWorkflow(rel(full), lines, out);
  }
  return out;
}
