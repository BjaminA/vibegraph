// `brief <entry>` (2026-09-29) — the MCP tool vibegraph_thread_brief for a
// plain Claude with no server: one call returns a thread's contract and the
// verbatim source of its PRIMARY functions (src/server/thread_brief.ts, the
// same builder the MCP tool uses). Zero tokens.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { threadContexts } from "../thread_context.mjs";
import { loadConstraints } from "../../src/server/constraint_store.ts";
import { formatContractBlock } from "../../src/server/thread_contract.ts";
import { buildThreadBrief } from "../../src/server/thread_brief.ts";
import { cliPath } from "./winpath.mjs";

export const BRIEF_USAGE = `brief <entry id> [<root>] [--max <chars>]   one thread: its contract, then the verbatim source of its
                                  PRIMARY functions only (ranked as the thread view ranks them); zero tokens`;

export function runBrief({ root, entryPointId, maxChars, pipeline }) {
  const absRoot = resolve(cliPath(root));
  const loaded = loadEnvelope(absRoot, null, pipeline ?? {}, { cache: true });
  const env = loaded.envelope;
  const thread = env.threads.find((t) => t.entryPointId === entryPointId);
  if (!thread) {
    const near = env.threads.map((t) => t.entryPointId).filter((id) => id && id.includes(entryPointId.split(":").pop() ?? entryPointId)).slice(0, 8);
    return { text: `No thread for ${entryPointId}.${near.length ? ` Did you mean: ${near.join(", ")}?` : ""}\n`, exitCode: 1 };
  }
  let constraints = [];
  try { constraints = loadConstraints(absRoot); } catch { constraints = []; }
  const ctx = threadContexts(env, absRoot, constraints, { only: new Set([entryPointId]) });
  const c = ctx.byEntry.get(entryPointId);
  const brief = buildThreadBrief({
    thread, files: env.files, stack: ctx.stack, crossings: ctx.crossings,
    contractText: c ? formatContractBlock(c.contract) : "(no contract)",
    readSource: (rel) => { try { return readFileSync(join(absRoot, rel), "utf-8"); } catch { return null; } },
    ...(maxChars ? { maxChars } : {}),
  });
  return { text: brief.text + "\n", exitCode: 0, brief };
}
