// LOCALHOST ONLY, and only for this app (2026-09-29, from Ben asking whether
// VibeGraph can run on sensitive code without exposing it). Binding to
// 127.0.0.1 keeps other machines out, but not a web page open in the same
// browser: a WebSocket is not subject to CORS, so any site could connect to
// ws://localhost:4200 and drive VibeGraph — read the project, rewrite files,
// start a Claude Code session. And a site whose DNS answers 127.0.0.1 (DNS
// rebinding) is same-origin with us unless the Host header is checked.
//
//   Host     must be this server's own name (localhost / 127.0.0.1 / [::1],
//            on its port) — defeats DNS rebinding. Skipped only when VG_HOST
//            deliberately exposes the server (already a loud warning).
//   Origin   a browser's WebSocket and /mcp requests must come from this
//            server's own page; no Origin at all is a non-browser client (a
//            local process, which already has the user's file access).
//   /mcp     POST must be application/json, so a page cannot send it as a
//            CORS "simple request" that skips the browser's preflight.
//   static   files are served from the bundle directory only — no `..`.
//
// Pure; server.ts calls these at the top of the HTTP handler and in the
// WebSocket server's verifyClient.

import * as fs from "fs";
import * as path from "path";

/** Files under .vibegraph/ that hold COPIES of the project's data — the run
 *  snapshots (whole files), a run's diffs, a trace's observed runtime values
 *  — are ignored by git from inside .vibegraph/, so a commit of the project
 *  cannot carry them whatever the project's own .gitignore says. Written
 *  once, beside whatever writes them; a person's own lines are kept. */
const PRIVATE_LINES = ["work-snapshots/", "hooked-run.json", "observations.json", "knowledge/"];
export function ensurePrivateIgnore(root: string): void {
  const p = path.join(root, ".vibegraph", ".gitignore");
  try {
    const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
    const have = new Set(cur.split("\n").map((l) => l.trim()));
    const missing = PRIVATE_LINES.filter((l) => !have.has(l));
    if (!missing.length) return;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const head = cur ? "" : "# VibeGraph: copies of your code and runtime data — never committed\n";
    fs.writeFileSync(p, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}${head}${missing.join("\n")}\n`);
  } catch { /* a read-only tree: nothing is written anywhere else either */ }
}

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

export interface GuardConfig { port: number; exposedHost: string | null }

/** The Host header names this server on loopback (or the server was
 *  deliberately exposed with VG_HOST, where no name list is possible). */
export function hostAllowed(host: string | undefined, cfg: GuardConfig): boolean {
  if (cfg.exposedHost) return true;
  if (!host) return false;
  const h = host.toLowerCase();
  return LOOPBACK.some((name) => h === `${name}:${cfg.port}` || (cfg.port === 80 && h === name));
}

/** A browser request's Origin is this server's own page; absent = not a
 *  browser. The VS Code webview scheme is the extension's own page. */
export function originAllowed(origin: string | undefined, host: string | undefined, cfg: GuardConfig): boolean {
  if (!origin) return true;
  if (origin.startsWith("vscode-webview://")) return true;
  let u: URL;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const originHost = u.host.toLowerCase();
  if (cfg.exposedHost) return !!host && originHost === host.toLowerCase();
  return LOOPBACK.some((name) => originHost === `${name}:${cfg.port}` || (cfg.port === 80 && originHost === name));
}

export function jsonContentType(ct: string | undefined): boolean {
  return !!ct && ct.toLowerCase().split(";")[0].trim() === "application/json";
}

/** The bundle file a URL names, or null when it would leave the bundle. */
export function staticPath(distDir: string, url: string | undefined): string | null {
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(url ?? "/", "http://vibegraph").pathname); } catch { return null; }
  const root = path.resolve(distDir);
  const abs = path.resolve(root, `.${pathname}`);
  return abs.startsWith(root + path.sep) ? abs : null;
}
