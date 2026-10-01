// A file's text at HEAD (2026-10-01), for the plan's rename check: a name the
// plan uses that a changed file DEFINED at HEAD and nothing defines now was
// renamed or removed. Null when there is no repository, no HEAD, or the file
// is new.
import { execFileSync } from "node:child_process";

export function headText(root, file) {
  try {
    return execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return null;
  }
}
