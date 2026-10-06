// The project's own prose, for `plan draft --direction` (2026-10-06, direction
// review M2): what its people already wrote about where it is going — README,
// CLAUDE.md, HANDOVER.md, docs/**.md and recent commit subjects. Read from the
// project only, capped; never a .env, never outside the root.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const PER_FILE = 12_000;
const TOTAL = 48_000;
const DOC_DIR_FILES = 24;

export const DIRECTION_HINT = "This is a DIRECTION draft for a project that already exists: its observed processes are in the plan. "
  + "Propose (1) the objective, as {\"op\":\"objective\",\"text\":\"…\",\"cite\":\"…\"}; (2) 3 to 7 PRINCIPLES the project's people state "
  + "(who alone may write what, one identity per person, what is never done), as policies {text, why, check?}; (3) a better name for "
  + "an observed process where the prose names it, as {\"op\":\"name\",\"id\":\"<process id>\",\"label\":\"…\",\"cite\":\"…\"}. "
  + "Every line quotes the prose it comes from; nothing else.";

function mdFiles(dir, out, depth = 0) {
  if (depth > 3 || out.length >= DOC_DIR_FILES) return;
  let names = [];
  try { names = readdirSync(dir).sort(); } catch { return; }
  for (const n of names) {
    if (n.startsWith(".") || n === "node_modules") continue;
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) mdFiles(p, out, depth + 1);
    else if (/\.md$/i.test(n) && out.length < DOC_DIR_FILES) out.push(p);
  }
}

export function projectProse(root) {
  const files = ["README.md", "CLAUDE.md", "HANDOVER.md"].map((f) => join(root, f)).filter((p) => existsSync(p));
  mdFiles(join(root, "docs"), files);
  const docs = [];
  let room = TOTAL;
  for (const p of files) {
    if (room <= 0) break;
    let text;
    try { text = readFileSync(p, "utf-8"); } catch { continue; }
    const t = text.slice(0, Math.min(PER_FILE, room));
    room -= t.length;
    docs.push({ ref: relative(root, p), text: t });
  }
  const log = spawnSync("git", ["log", "-n", "40", "--format=%s"], { cwd: root, encoding: "utf-8" });
  if (log.status === 0 && log.stdout.trim()) docs.push({ ref: "recent commit subjects", text: log.stdout.trim() });
  return docs;
}
