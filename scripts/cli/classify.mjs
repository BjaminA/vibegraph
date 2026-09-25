// M-CMD.3 — `classify`: the ONE command in this package that spends tokens.
//
// Everything else here is derived or stated. This asks a model what the
// tools no table knows ARE — from the evidence the IR already holds about
// how the codebase uses them (src/server/stack_classify.ts) — and stores
// each answer as an AGENT-STATED `describe` policy in
// .vibegraph/constraints.json: labelled as a model's classification wherever
// the role shows, outranked by a human's statement, and ratified by a person
// setting `source` to "human". Nothing is written without --apply, and
// --dry-run spawns nothing at all.
//
// The spawn mirrors the server's reasoning spawns (server.ts _runReadmeLlm):
// `claude -p --output-format json`, no MCP servers, the raw write tools AND
// Bash denied structurally. VG_CLAUDE_BIN swaps the binary (tests drive a
// canned-reply stub; a `.mjs` path runs under this node).
//
// Air-gapped flow: --dossier-out writes the evidence + prompt as JSON;
// --from-dossier reads it back (no parse step, so no Python needed); and
// --reply <file> uses a saved model reply instead of spawning.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import {
  applyClassifications, buildClassifyPrompt, collectUnknownTools,
  formatDossierReport, formatReplyReport, parseClassifyResponse,
} from "../../src/server/stack_classify.ts";

/** The server's CHAT_DENIED_TOOLS plus Bash: a classifier reads, never runs. */
export const CLASSIFY_DENIED_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"];

/** `VG_CLAUDE_BIN` may be a binary, a node script, or either followed by
 *  arguments (`claude --model haiku`); the first token is what to run. */
export function classifierTarget(env = process.env) {
  const raw = (env.VG_CLAUDE_BIN ?? "claude").trim();
  const [bin, ...pre] = raw.split(/\s+/);
  if (/\.(mjs|cjs|js)$/.test(bin)) return { cmd: process.execPath, args: [resolve(bin), ...pre], label: bin };
  return { cmd: bin, args: pre, label: bin };
}

/** One reasoning spawn. Returns the model's reply TEXT, or the failure. */
export function spawnClassifier({ prompt, model, cwd, timeoutMs = 10 * 60 * 1000, env = process.env }) {
  const target = classifierTarget(env);
  const args = [
    ...target.args,
    "-p", "--output-format", "json", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--dangerously-skip-permissions",
    "--disallowedTools", CLASSIFY_DENIED_TOOLS.join(","),
    ...(model ? ["--model", model] : []),
    "--", prompt,
  ];
  const r = spawnSync(target.cmd, args, { cwd, encoding: "utf-8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return { ok: false, error: `could not spawn ${target.label}: ${r.error.message}`, label: target.label };
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  if (r.status !== 0 || parsed?.is_error) {
    const said = parsed?.is_error && typeof parsed.result === "string" ? parsed.result.trim() : (r.stderr || r.stdout || "").trim().slice(0, 400);
    return { ok: false, error: `${target.label} exited ${r.status}${said ? `: ${said}` : ""}`, label: target.label };
  }
  const text = typeof parsed?.result === "string" ? parsed.result : typeof parsed?.result === "object" && parsed?.result ? JSON.stringify(parsed.result) : "";
  if (!text) return { ok: false, error: `${target.label} returned no result text`, label: target.label };
  const modelLabel = model ?? (pre(env) ?? (typeof parsed?.model === "string" ? parsed.model : target.label));
  return { ok: true, text, label: target.label, model: modelLabel };
}

function pre(env) {
  const m = /--model\s+(\S+)/.exec(env.VG_CLAUDE_BIN ?? "");
  return m ? m[1] : null;
}

/**
 * @returns {{ dossiers, prompt, spawned: boolean, reply?, parsed?, applied?, exitCode: number, messages: string[] }}
 */
export function runClassify({
  root, envelope, pipeline, dryRun = false, apply = false, model, fromDossier, dossierOut, replyFile,
  log = () => {}, env = process.env,
}) {
  const absRoot = resolve(root);
  const messages = [];
  let dossiers;
  let prompt;
  if (fromDossier) {
    const saved = JSON.parse(readFileSync(resolve(fromDossier), "utf-8"));
    dossiers = saved.dossiers ?? [];
    prompt = saved.prompt ?? buildClassifyPrompt(dossiers, { project: saved.project });
    log(`read ${dossiers.length} dossier(s) from ${fromDossier}`);
  } else {
    const { envelope: envl, parseErrors } = loadEnvelope(absRoot, envelope, pipeline ?? {});
    const stack = buildStackIndex(envl, absRoot);
    dossiers = collectUnknownTools(envl, stack, { root: absRoot });
    prompt = buildClassifyPrompt(dossiers, { project: absRoot.split(/[\\/]/).pop() });
    if (Object.keys(parseErrors).length) messages.push(`parse errors (those files carry no IR): ${Object.keys(parseErrors).join(", ")}`);
  }
  if (dossierOut) {
    writeFileSync(resolve(dossierOut), JSON.stringify({ project: absRoot, dossiers, prompt }, null, 2) + "\n");
    messages.push(`wrote the evidence and the prompt to ${dossierOut}`);
  }
  if (!dossiers.length) return { dossiers, prompt, spawned: false, exitCode: 0, messages };
  if (dryRun) return { dossiers, prompt, spawned: false, exitCode: 0, messages };

  let reply;
  let modelLabel = model ?? "claude";
  if (replyFile) {
    reply = readFileSync(resolve(replyFile), "utf-8");
    modelLabel = model ?? `saved reply ${replyFile}`;
  } else {
    const r = spawnClassifier({ prompt, model, cwd: absRoot, env });
    if (!r.ok) return { dossiers, prompt, spawned: true, exitCode: 3, messages: [...messages, r.error] };
    reply = r.text;
    modelLabel = r.model;
  }
  const parsed = parseClassifyResponse(reply, dossiers);
  const applied = apply && parsed.accepted.length ? applyClassifications(absRoot, parsed.accepted, dossiers, { model: modelLabel }) : null;
  if (apply && applied?.added.length) messages.push(`next: re-run export so the spec, the contracts and every routed prompt carry the new roles`);
  if (!apply && parsed.accepted.length) messages.push(`nothing written (no --apply); ${parsed.accepted.length} classification(s) shown above would be stored agent-stated`);
  return { dossiers, prompt, spawned: !replyFile, reply, parsed, applied, exitCode: parsed.error ? 3 : 0, messages };
}

export function formatClassifyReport(r, { showPrompt = false } = {}) {
  let out = formatDossierReport(r.dossiers);
  if (showPrompt) out += "\n--- prompt the model receives ---\n" + r.prompt + "\n--- end prompt ---\n";
  if (r.parsed) out += "\n" + formatReplyReport(r.parsed, r.applied ?? null);
  return out;
}
