// The welcome to a NEW project (2026-10-21, Ben: "a button for this pop up if
// detected a new project i.e. vibegraph can spot its loaded on new instance
// and suggest this to the user"). The app opens on a project nobody has set
// up and offers the setup (setup_state.ts), once.
//
// "New" is read from the project's own files, never from the setup's count of
// done steps: on a project with no bespoke software that step already reads
// done. Nothing of the setup started here = no groups, Brief, plan, setup or
// direction file, no software spec, no stated rule (a package's classification
// is not one). Installed hooks do not count: `init --hooks` is often the first
// thing run on a project, before any of the setup (the first field report: a
// project whose .vibegraph had been deleted to start again was never offered
// it, because its hooks were still installed). "Not now" is remembered per
// person under ~/.cache, never in the project.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDirFor } from "../../scripts/cache_dir.mjs";
import { loadConstraints, statedRules } from "./constraint_store.ts";
import { listSpecs } from "./software_store.ts";

const PROJECT_FILES = ["architecture.json", "brief.json", "plan.json", "setup.json", "direction.json"];

/** Nothing of the setup has been started in this project. */
export function isFreshProject(root: string): boolean {
  if (PROJECT_FILES.some((f) => existsSync(join(root, ".vibegraph", f)))) return false;
  try { if (statedRules(loadConstraints(root)).length) return false; } catch { return false; }
  try { if (listSpecs(root).length) return false; } catch { /* none */ }
  return true;
}

const welcomeFile = (root: string) => join(cacheDirFor(root), "welcome.json");

export function welcomeDismissed(root: string): boolean {
  try { return !!JSON.parse(readFileSync(welcomeFile(root), "utf-8")).dismissedAt; } catch { return false; }
}

export function dismissWelcome(root: string, now: Date = new Date()): void {
  const p = welcomeFile(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ dismissedAt: now.toISOString() }) + "\n");
}

/** Offer the setup: a new project this person has not set aside, unless
 *  switched off (VG_WELCOME=off: the browser suites, which run on bare fixtures). */
export function offerWelcome(root: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VG_WELCOME !== "off" && isFreshProject(root) && !welcomeDismissed(root);
}
