// Said once at the start of a command (2026-10-07, from running `view` in WSL):
// the `vibegraph-knowledge` on a WSL PATH can be the WINDOWS install, reached
// through /mnt/c and run by whatever `node` comes first — there the system's
// Node 18, below the package's declared >=20. It works, slowly and on luck;
// these lines say so, and how to fix it. Never stops the command.
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectHost, isWindowsSide } from "../../src/server/host_os.ts";

/** 2026-10-07 (field report: inside a project, `npx vibegraph-knowledge`
 *  ran an older LOCAL copy instead of the global one, and the Plan panel then
 *  misread a plan.json the newer one wrote) — when a local and a global
 *  install both exist and differ, say which one this is. */
export function installMismatch(projectRoot, runningVersion, runningScript = process.argv[1] ?? "", npmRoot = globalNpmRoot) {
  const versionAt = (dir) => { try { return JSON.parse(readFileSync(join(dir, "vibegraph-knowledge", "package.json"), "utf-8")).version ?? null; } catch { return null; } };
  const local = versionAt(join(projectRoot, "node_modules"));
  const gRoot = npmRoot();
  const global = gRoot ? versionAt(gRoot) : null;
  if (!local || !global || local === global) return null;
  const runningLocal = runningScript.includes(join(projectRoot, "node_modules"));
  return `two installs disagree: this project's node_modules has ${local}, the global one is ${global}; this is ${runningLocal ? "the LOCAL" : "the global"} ${runningVersion ?? ""}`.trimEnd()
    + `. \`npx vibegraph-knowledge\` inside this folder runs the local copy — use \`npx vibegraph-knowledge@latest\` or the global binary, or update the local one.`;
}

function globalNpmRoot() {
  try {
    const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf-8", timeout: 4000 });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch { return null; }
}

/** 2026-10-07 (field report: the first export under Node 18 failed without
 *  saying why) — a Node below the declared minimum STOPS the command. */
export function nodeTooOld(nodeVersion = process.versions.node) {
  const major = Number(nodeVersion.split(".")[0]);
  return major < 20 ? `this is Node ${nodeVersion}; vibegraph-knowledge needs Node 20 or newer, and stops here rather than fail later without saying why (\`node --version\`; with nvm: \`nvm use 24\`)` : null;
}

export function hostWarnings(env = process.env, self = fileURLToPath(import.meta.url), nodeVersion = process.versions.node) {
  const out = [];
  if (detectHost(env).kind === "wsl" && isWindowsSide(self)) {
    out.push(`this is the WINDOWS install of vibegraph-knowledge (${self.replace(/\/dist\/.*$|\/scripts\/.*$/, "")}), run from WSL through /mnt/c — slow, and not the Node or Claude of your WSL. Install it inside WSL too: \`npm install -g vibegraph-knowledge\` (from a WSL shell, with a WSL Node)`);
  }
  return out;
}
