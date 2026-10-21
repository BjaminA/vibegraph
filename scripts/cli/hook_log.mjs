// `hook log` (2026-10-19, PLAN-M-RULES M4) — what each hook firing DID, so a
// session can be examined after the fact instead of guessed at.
//
// One JSON line per real firing, per project, under ~/.cache (beside the
// session state — never in the project). Each line: the event, how long it
// took, whether it parsed, the threads a prompt was routed to and HOW each
// matched (node id / file / symbol from the remit index, a KEYWORD guess, a
// planned thread), what was newly delivered (contracts, rules, skills), what
// the inline cap deferred or cut, and the findings an edit introduced (block
// or advisory, which rule). Never the prompt and never a command line: a
// shell command can carry a secret, so only its program and whether it
// touches .vibegraph/ are kept. Zero tokens. A manual `hook run` is not logged.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { cacheDirFor } from "../envelope_cache.mjs";

export const hookLogPath = (absRoot) => join(cacheDirFor(absRoot), "hook-log.jsonl");
/** Over this size the oldest half is dropped (a log, not an archive). */
const MAX_BYTES = 2_000_000;
const CUT_MARK = "more characters not shown — the inline limit";

/** The ids a session has been sent so far — compared before and after a firing. */
export function deliverySnapshot(state) {
  return {
    contracts: [...(state.contracts ?? [])],
    partial: Object.keys(state.partialContracts ?? {}),
    rules: [...(state.rules ?? [])],
    skills: Object.keys(state.injectedSkills ?? {}),
  };
}

const added = (a, b) => b.filter((x) => !a.includes(x));

/** The program a shell command runs first (after VAR=value assignments). */
export function programOf(command) {
  const s = String(command ?? "").replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+)*/, "");
  const word = s.match(/^\s*("[^"]*"|'[^']*'|\S+)/)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  return word.split(/[\\/]/).pop().slice(0, 40) || null;
}

/** The routing a prompt made, for the log: `matches` are the remit matches
 *  (or keyword guesses carrying `weakTerms`), `plannedIds` planned threads. */
export function noteRouting(trace, matches, plannedIds) {
  trace.routed = matches.map((m) => m.weakTerms
    ? { ep: m.entryPointId, how: "keyword", on: m.weakTerms }
    : { ep: m.entryPointId, how: [...new Set(m.matchedOn.map((t) => t.kind))].join("+"), on: m.matchedOn.map((t) => t.token).slice(0, 4) });
  if (plannedIds?.length) trace.planned = [...plannedIds];
}

/** The findings an edit or stop produced, for the log. */
export function noteFindings(trace, { introduced = [], earlier = [], fresh = null, blocked = [] }) {
  const brief = (f) => ({ id: f.id, rule: f.rule, verdict: f.verdict, gates: !!f.gates });
  trace.findings = {
    introduced: [...new Map(introduced.map((f) => [`${f.id}|${f.rule}|${f.verdict}`, brief(f)])).values()],
    earlier: earlier.length,
    ...(fresh ? { fresh: fresh.length } : {}),
    blocked: [...new Set(blocked.map((f) => f.id))],
  };
}

/** One log line from a firing. */
export function logEntry(event, input, out, trace, { absRoot, ms, parsed, before, after, at = new Date() }) {
  const text = out?.block ?? out?.json?.hookSpecificOutput?.additionalContext ?? out?.json?.systemMessage ?? "";
  const e = {
    at: at.toISOString(), session: input.session_id ?? null, event, ms, parsed,
    outcome: out?.block ? "block" : out?.json?.hookSpecificOutput ? "context" : out?.json?.systemMessage ? "message" : "silent",
    chars: text.length,
  };
  if (text.includes(CUT_MARK)) e.cut = true;
  if (event === "session-start") e.source = String(input.source ?? "startup");
  if (event === "prompt") e.promptChars = String(input.prompt ?? "").length;
  if (event === "post-edit") {
    e.tool = input.tool_name ?? null;
    const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (typeof target === "string") {
      const rel = relative(absRoot, isAbsolute(target) ? target : resolve(absRoot, target)).split("\\").join("/");
      e.file = rel.startsWith("..") ? "(outside the project)" : rel;
      if (rel.startsWith(".vibegraph/")) e.vibegraph = true;
    } else if (typeof input.tool_input?.command === "string") {
      e.program = programOf(input.tool_input.command);
      if (/\.vibegraph[\\/]/.test(input.tool_input.command)) e.vibegraph = true;
    }
  }
  for (const k of ["routed", "planned", "deferred", "findings", "skipped"]) if (trace[k]?.length ?? trace[k]) e[k] = trace[k];
  if (event === "session-start" && (e.source === "compact" || e.source === "clear")) e.reset = after.contracts.length === 0 && after.rules.length === 0;
  const sent = { contracts: added(before.contracts, after.contracts), rules: added(before.rules, after.rules), skills: added(before.skills, after.skills) };
  const held = after.partial.filter((p) => !before.partial.includes(p));
  if (held.length) sent.partly = held;
  if (Object.values(sent).some((v) => v.length)) e.sent = sent;
  return e;
}

export function appendHookLog(absRoot, entry) {
  try {
    const p = hookLogPath(absRoot);
    mkdirSync(join(p, ".."), { recursive: true });
    if (existsSync(p) && statSync(p).size > MAX_BYTES) {
      const lines = readFileSync(p, "utf-8").split("\n").filter(Boolean);
      writeFileSync(p, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
    }
    appendFileSync(p, JSON.stringify(entry) + "\n");
  } catch { /* a log that cannot be written must never break the hook */ }
}

export function readHookLog(absRoot) {
  try {
    return readFileSync(hookLogPath(absRoot), "utf-8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** The entries of one session (default: the one that fired last). */
export function sessionEntries(entries, session) {
  const id = session ?? entries.at(-1)?.session;
  return { id, entries: entries.filter((e) => e.session === id) };
}

const hhmmss = (iso) => iso.slice(11, 19);
const routeText = (r) => `${r.ep} (${r.how === "keyword" ? `KEYWORD guess: ${r.on.map((t) => `"${t}"`).join(", ")}` : `${r.how}: ${r.on.join(", ")}`})`;

function lineFor(e) {
  const head = `${hhmmss(e.at)}  ${e.event.padEnd(13)} ${String(e.ms).padStart(6)} ms  ${e.parsed ? "parsed " : "no parse"}`;
  const bits = [];
  if (e.source) bits.push(`source ${e.source}${e.reset === true ? " — delivery record reset" : e.reset === false ? " — delivery record NOT reset" : ""}`);
  if (e.tool) bits.push(`${e.tool}${e.file ? ` ${e.file}` : ""}${e.program ? ` (${e.program})` : ""}${e.vibegraph ? " — TOUCHES .vibegraph/" : ""}`);
  bits.push(`${e.outcome}${e.chars ? ` ${e.chars} chars` : ""}${e.cut ? " (CUT at the inline limit)" : ""}`);
  const out = [`${head}  ${bits.join(" · ")}`];
  if (e.routed?.length) out.push(`    routed: ${e.routed.map(routeText).join("; ")}`);
  else if (e.event === "prompt") out.push(`    routed: none${e.planned?.length ? "" : " (no code-shaped token, no keyword guess)"}`);
  if (e.planned?.length) out.push(`    planned threads: ${e.planned.join(", ")}`);
  if (e.deferred?.length) out.push(`    deferred (over the inline limit): ${e.deferred.join(", ")}`);
  if (e.sent) out.push(`    sent: ${Object.entries(e.sent).filter(([, v]) => v.length).map(([k, v]) => `${k} ${v.join(", ")}`).join(" · ")}`);
  if (e.findings) {
    const f = e.findings;
    const intro = f.introduced.map((x) => `${x.id} ${x.rule} ${x.verdict}${x.verdict === "violated" ? (x.gates ? " (gates)" : " (advisory)") : ""}`);
    out.push(`    findings: ${intro.length ? `introduced ${intro.join(", ")}` : "none introduced"}${f.earlier ? ` · ${f.earlier} earlier` : ""}${f.fresh != null ? ` · ${f.fresh} new this session` : ""}${f.blocked.length ? ` · BLOCKED on ${f.blocked.join(", ")}` : ""}`);
  }
  if (e.skipped) out.push(`    ${e.skipped}`);
  return out.join("\n");
}

/** Totals over a session: what M4's examination reads first. */
export function summarise(entries) {
  const by = (ev) => entries.filter((e) => e.event === ev);
  const prompts = by("prompt");
  const edits = by("post-edit");
  const shell = edits.filter((e) => e.program !== undefined || (e.tool && !e.file));
  const ctx = prompts.map((e) => e.chars).filter((n) => n > 0);
  const sum = (a) => a.reduce((s, n) => s + n, 0);
  return {
    firings: entries.length,
    msTotal: sum(entries.map((e) => e.ms)),
    orientationChars: sum(by("session-start").map((e) => e.chars)),
    prompts: prompts.length,
    promptContextChars: { total: sum(ctx), max: ctx.length ? Math.max(...ctx) : 0 },
    keywordRoutes: prompts.flatMap((e) => (e.routed ?? []).filter((r) => r.how === "keyword")).length,
    deferred: sum(prompts.map((e) => e.deferred?.length ?? 0)),
    cut: entries.filter((e) => e.cut).length,
    edits: edits.length,
    shellEdits: shell.length,
    shellParsed: shell.filter((e) => e.parsed).length,
    shellParseMs: sum(shell.filter((e) => e.parsed).map((e) => e.ms)),
    blocks: edits.filter((e) => e.outcome === "block").length,
    stopBlocks: by("stop").filter((e) => e.outcome === "block").length,
    advisories: sum(entries.map((e) => (e.findings?.introduced ?? []).filter((f) => !(f.verdict === "violated" && f.gates)).length)),
    vibegraphEdits: edits.filter((e) => e.vibegraph).length,
    resets: by("session-start").filter((e) => e.source === "compact" || e.source === "clear").map((e) => e.reset),
  };
}

export function formatHookLog({ id, entries }) {
  if (!entries.length) return "No hook firings recorded for this project (a manual `hook run` is not logged; the hooks log from the next real firing).\n";
  const s = summarise(entries);
  const head = [
    `session ${id ?? "(none)"}: ${s.firings} firing(s), ${entries[0].at.slice(0, 16).replace("T", " ")} → ${entries.at(-1).at.slice(11, 16)}, ${s.msTotal} ms in hooks`,
    `  orientation ${s.orientationChars} chars · ${s.prompts} prompt(s), ${s.promptContextChars.total} chars of context (max ${s.promptContextChars.max}) · ${s.keywordRoutes} keyword-guess route(s) · ${s.deferred} deferred · ${s.cut} cut`,
    `  ${s.edits} post-edit firing(s), ${s.shellEdits} from a shell (${s.shellParsed} parsed, ${s.shellParseMs} ms) · ${s.blocks} edit block(s), ${s.stopBlocks} at stop · ${s.advisories} advisory finding(s)${s.vibegraphEdits ? ` · ${s.vibegraphEdits} edit(s) of .vibegraph/` : ""}${s.resets.length ? ` · ${s.resets.length} compaction/clear (${s.resets.filter((r) => r === true).length} reset)` : ""}`,
    "",
  ];
  return `${head.join("\n")}${entries.map(lineFor).join("\n")}\n`;
}

/** Every session in the log, newest last: id, firings, first and last time. */
export function listSessions(entries) {
  const m = new Map();
  for (const e of entries) {
    const s = m.get(e.session) ?? { id: e.session, firings: 0, first: e.at, last: e.at };
    s.firings += 1; s.last = e.at;
    m.set(e.session, s);
  }
  return [...m.values()];
}

/** `hook log` — the text the command prints. */
export function hookLogText(absRoot, { session, list, json } = {}) {
  const all = readHookLog(absRoot);
  if (list) {
    const rows = listSessions(all);
    if (json) return JSON.stringify(rows, null, 2) + "\n";
    return rows.length ? rows.map((s) => `${s.id}  ${s.firings} firing(s)  ${s.first.slice(0, 16).replace("T", " ")} → ${s.last.slice(11, 16)}`).join("\n") + "\n" : "No hook firings recorded for this project.\n";
  }
  const picked = sessionEntries(all, session);
  if (json) return JSON.stringify({ session: picked.id, summary: summarise(picked.entries), entries: picked.entries }, null, 2) + "\n";
  return formatHookLog(picked);
}
