// Who a person's step is recorded as (2026-10-05): the git author name of
// the analysed project, else the OS account name. The viewer and the CLI run
// on the person's own machine as that person, so this is who clicked or
// typed. It names the person in a rule's history; it is not authentication.

import { execFileSync } from "node:child_process";
import * as os from "node:os";

export function personName(root: string): string {
  try {
    const n = execFileSync("git", ["config", "user.name"], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (n) return n.slice(0, 80);
  } catch { /* not a repository, or no name set */ }
  try { return os.userInfo().username.slice(0, 80) || "a person"; } catch { return "a person"; }
}
