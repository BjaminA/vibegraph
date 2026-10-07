// `vibegraph-knowledge view` (2026-09-25) — the VISUALISATION from the npm
// package: the same server and web app `./runVis.sh` starts from a clone,
// shipped prebuilt under vendor/ (scripts/cli/build.mjs), so a user needs
// `npm install -g vibegraph-knowledge` and nothing else.
//
//   view [<path>] [--port <n>] [--open]
//
// What it does, in order:
//   1. finds the prebuilt server: <package>/vendor/dist/server.js (installed),
//      or the checkout's dist/server.js after `npm run build` (dev);
//   2. makes sure python3 can import libcst (the parser) and black >= 24 (the
//      edit formatter), installing them into ~/.cache/vibegraph-knowledge the
//      first time — the pyenv.mjs route every other command uses;
//   3. starts the server on the project and stays in the foreground until
//      Ctrl-C, exactly like runVis.sh.
//
// The server binds 127.0.0.1 and has no authentication; VG_HOST opts out,
// loudly (the server says so). Everything it writes into the project lives
// under <project>/.vibegraph/.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureBlack, resolvePython } from "./pyenv.mjs";
import { cliPath } from "./winpath.mjs";
import { detectHost, openUrlCommands } from "../../src/server/host_os.ts";

export const VIEW_USAGE = `view [<path>] [--port <n>] [--open]   THE VISUALISATION: start the web app on a project (or one file)
                                               and serve it at http://localhost:4200; Ctrl-C stops it`;

/** The prebuilt server, installed or dev. */
export function serverPath(loc) {
  const installed = join(loc.packageRoot, "vendor", "dist", "server.js");
  if (existsSync(installed)) return installed;
  if (loc.repoRoot) {
    const dev = join(loc.repoRoot, "dist", "server.js");
    if (existsSync(dev)) return dev;
  }
  return null;
}

/** The browser, the way this host opens one (host_os.ts): on WSL the
 *  Windows browser through interop — `xdg-open` there usually opens nothing. */
function openBrowser(url) {
  for (const { cmd, args, cwd } of openUrlCommands(url)) {
    const r = spawnSync(cmd, args, { stdio: "ignore", shell: false, ...(cwd && existsSync(cwd) ? { cwd } : {}) });
    // explorer.exe answers 1 even when it opened the page
    if (!r.error && (r.status === 0 || /explorer\.exe$/i.test(cmd))) return true;
  }
  return false;
}

/** @returns {Promise<number>} the exit code */
export function runView({ loc, target, port, open, log = (m) => process.stderr.write(`  ${m}\n`) }) {
  const abs = resolve(cliPath(target ?? "."));
  if (!existsSync(abs)) { log(`${abs} does not exist`); return Promise.resolve(2); }
  const server = serverPath(loc);
  if (!server) {
    log("the visualisation is not built into this install (vendor/dist/server.js is missing). In a checkout run `npm run build` (or `npm run build:cli`) first.");
    return Promise.resolve(3);
  }
  let env;
  try {
    // python3, else python (a Windows install often has only python.exe), else
    // VG_PYTHON; the server then uses the SAME interpreter for every spawn
    const py = resolvePython({ ...loc }, { log });
    const black = ensureBlack(py, loc, { log });
    if (!black.ok) log(black.error);
    env = { ...black.env, VG_PYTHON: process.env.VG_PYTHON || py.bin };
  } catch (e) {
    log(`${e.message}\nThe visualisation runs its parser, edits and runs through Python; install Python 3.10+ and retry.`);
    return Promise.resolve(3);
  }
  const host = detectHost();
  log(`host: ${host.kind === "wsl" ? `WSL${host.distro ? ` (${host.distro})` : ""}` : host.kind} · node ${process.version} · python ${env.VG_PYTHON}`);
  const p = port ?? process.env.PORT ?? "4200";
  env = { ...env, PORT: String(p) };
  const url = `http://localhost:${p}`;
  log(`${statSync(abs).isDirectory() ? "project" : "file"}: ${abs}`);
  log(`starting VibeGraph at ${url} — Ctrl-C to stop`);

  return new Promise((done) => {
    const child = spawn(process.execPath, [server, abs], { stdio: ["inherit", "pipe", "inherit"], env });
    let opened = !open;
    child.stdout.on("data", (buf) => {
      process.stdout.write(buf);
      if (!opened && /VibeGraph is running/.test(buf.toString())) {
        opened = true;
        if (!openBrowser(url)) log(`open ${url} in your browser`);
      }
    });
    // Stopping `view` stops the server — Ctrl-C, a kill, or a closed terminal —
    // and never leaves it running on its own: a first test run did, once.
    let exited = false;
    const stop = (sig) => {
      if (exited) return;
      child.kill(sig);
      setTimeout(() => { if (!exited) child.kill("SIGKILL"); }, 3000).unref();
    };
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(sig));
    process.on("exit", () => { if (!exited) child.kill("SIGKILL"); });
    child.on("exit", (code, sig) => { exited = true; done(sig ? 0 : (code ?? 0)); });
  });
}
