// Said once at the start of a command (2026-10-07, from running `view` in WSL):
// the `vibegraph-knowledge` on a WSL PATH can be the WINDOWS install, reached
// through /mnt/c and run by whatever `node` comes first — there the system's
// Node 18, below the package's declared >=20. It works, slowly and on luck;
// these lines say so, and how to fix it. Never stops the command.
import { fileURLToPath } from "node:url";
import { detectHost, isWindowsSide } from "../../src/server/host_os.ts";

export function hostWarnings(env = process.env, self = fileURLToPath(import.meta.url), nodeVersion = process.versions.node) {
  const out = [];
  const major = Number(nodeVersion.split(".")[0]);
  if (major < 20) out.push(`this is Node ${nodeVersion}; vibegraph-knowledge needs Node 20 or newer (\`node --version\`; with nvm: \`nvm use 24\`)`);
  if (detectHost(env).kind === "wsl" && isWindowsSide(self)) {
    out.push(`this is the WINDOWS install of vibegraph-knowledge (${self.replace(/\/dist\/.*$|\/scripts\/.*$/, "")}), run from WSL through /mnt/c — slow, and not the Node or Claude of your WSL. Install it inside WSL too: \`npm install -g vibegraph-knowledge\` (from a WSL shell, with a WSL Node)`);
  }
  return out;
}
