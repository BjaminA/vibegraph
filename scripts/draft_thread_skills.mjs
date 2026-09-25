#!/usr/bin/env node
// Draft thread skills for named threads against a RUNNING VibeGraph server,
// and — only under a recorded human ruling — ratify them as a model.
//
// Why this exists. A constraint routes PER RUN: it is delivered fresh to the
// workers a task touches, then it is gone. A skill persists PER THREAD: it is
// ratified once and every future agent on that thread inherits it, with the
// REASON beside the rule (M-WHY: "understanding the why is the most important
// thing, and is the thing the worker would add to their thread skills").
// Head-to-head #3 found the gap: not one example project had a single skill,
// so the why reached agents per run and evaporated. Drafting is one model
// spawn per thread, which is why this names its threads rather than sweeping.
//
//   node --experimental-strip-types --no-warnings scripts/draft_thread_skills.mjs \
//     --port 4200 --root examples/fleet-telemetry \
//     --thread telemetry/alerts.py:evaluate --thread telemetry/export.py:export_csv
//
//   ...--ratify-as human                       flip to ratified as a human
//   ...--ratify-as model --model <label> \     ...or as a MODEL, which REQUIRES
//      --ruling ruling:YYYY-MM-DD:<id>         the human ruling that delegated it
//
// Ratification does NOT go through the MCP tool, which refuses it by design.
// It goes through the store's sanctioned writer with the ratifier recorded,
// so a delegated ratification can never read as a human's: the file carries
// who, and every prompt the skill is injected into carries the caveat.
import { resolve } from "node:path";
import { ratifyThreadSkill } from "../src/server/thread_skill_store.ts";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const all = (n) => args.reduce((acc, a, i) => (a === `--${n}` ? [...acc, args[i + 1]] : acc), []);

const port = Number(opt("port", "4200"));
const root = resolve(opt("root", "."));
const threads = all("thread");
const ratifyAs = opt("ratify-as", null);
const model = opt("model", null);
const ruling = opt("ruling", null);

if (!threads.length) {
  console.error("usage: draft_thread_skills.mjs --port N --root <project> --thread <entryPointId> [--thread ...]");
  console.error("       [--ratify-as human | --ratify-as model --model <label> --ruling <id>]");
  process.exit(2);
}
if (ratifyAs === "model" && (!model || !ruling)) {
  console.error("--ratify-as model REQUIRES --model <audit label> and --ruling <the human ruling that delegated it>:");
  console.error("a model's ratification must never be indistinguishable from a human's.");
  process.exit(2);
}
if (ratifyAs && ratifyAs !== "human" && ratifyAs !== "model") {
  console.error(`--ratify-as must be human or model, not ${ratifyAs}`);
  process.exit(2);
}

const MCP = `http://localhost:${port}/mcp`;
let sessionId = null, nextId = 1;

function sseJson(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("data: "));
  if (!lines.length) throw new Error(`no SSE data frame: ${text.slice(0, 200)}`);
  return JSON.parse(lines[lines.length - 1].slice("data: ".length));
}
async function rpc(method, params) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!sessionId) sessionId = res.headers.get("mcp-session-id");
  return sseJson(await res.text());
}

const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "draft-thread-skills", version: "0.0.1" } });
if (init.result?.serverInfo?.name !== "vibegraph") { console.error(`not a vibegraph server on ${port}`); process.exit(1); }
await fetch(MCP, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
});

let drafted = 0, failed = 0;
for (const entryPointId of threads) {
  process.stdout.write(`${entryPointId} … `);
  const r = await rpc("tools/call", { name: "vibegraph_generate_thread_skill", arguments: { entryPointId } });
  const text = r.result?.content?.[0]?.text ?? "";
  if (r.result?.isError || !text.trim()) {
    failed++;
    console.log(`FAILED: ${text.slice(0, 160) || JSON.stringify(r).slice(0, 160)}`);
    continue;
  }
  drafted++;
  const rules = (text.match(/^- /gm) ?? []).length;
  console.log(`drafted (${text.length} chars, ${rules} bullet(s))`);
  if (!ratifyAs) continue;
  const by = ratifyAs === "human"
    ? { kind: "human" }
    : { kind: "model", model, delegatedBy: { source: "human", id: ruling, at: new Date().toISOString() } };
  const rec = ratifyThreadSkill(root, entryPointId, by);
  console.log(`  ratified by ${ratifyAs}${ratifyAs === "model" ? ` (${model}, under ${ruling})` : ""}: ${rec ? "written" : "NO STORED SKILL — not ratified"}`);
}
// Say what happened, not what was asked for: a run where every draft failed
// must not report "ratified as model" — nothing was ratified, because a
// failed draft is skipped before the ratify step.
const ratifyNote = !ratifyAs
  ? " (not ratified: no --ratify-as)"
  : drafted
    ? `, ${drafted} ratified as ${ratifyAs}`
    : " (nothing ratified: no draft succeeded)";
console.log(`\n${drafted} drafted, ${failed} failed${ratifyNote}`);
process.exit(failed ? 1 : 0);
