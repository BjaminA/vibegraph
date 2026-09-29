// `hook <event>` (2026-09-28) — VibeGraph inside ONE warm Claude Code session.
//
// The head-to-heads measured the same thing three times: plain Claude with
// the knowledge on disk matched the orchestrated run's quality at 2–4× the
// speed, and what the orchestration added was DELIVERY (each worker handed
// its thread's contract, rules and skill) and ENFORCEMENT (a deterministic
// check that rejects). Claude Code hooks give a single session both, with no
// extra model spawn:
//
//   session-start  SessionStart — an orientation (the project, its entry
//              points, every stated rule in one line, the skills) and the
//              session's BASELINE of findings. After a COMPACTION (or /clear)
//              the delivery record is reset, because what earlier prompts
//              delivered was summarised away and "already given" is no longer
//              true (2026-09-29, found reviewing OpenViking's hooks).
//   prompt     UserPromptSubmit — route the prompt to the threads that own it
//              (the chat's remit matcher) and add their contract, routed
//              rules and ratified skill, once per session each. A prompt that
//              names no code gets a KEYWORD match over the code's own words,
//              labelled a guess (thread_keywords.ts).
//   post-edit  PostToolUse on Write|Edit|MultiEdit|NotebookEdit|Bash — re-check
//              every stated rule. A NEW violation of a rule whose verb may
//              gate BLOCKS, naming the rule and the offending call; anything
//              else new is a note; the tests that reach the edit are listed.
//   stop       Stop — the same check once more before the turn may end.
//
// Every context a hook hands Claude stays under Claude Code's 10,000-
// character inline limit (INLINE_CAP): over it, Claude Code saves the text to
// a file and Claude must spend a tool call reading it — which h2h4's arms did.
// What does not fit is named and left undelivered, so a later prompt sends it.
//
// Only NEW findings count (relative to the session baseline): a violation
// the tree already had is not this session's doing, and blocking on it would
// block forever — the derived-gate rule (src/server/quality/derived_gate.ts).
// A blocked violation that later clears is recorded as a LESSON
// (scripts/cli/lessons.mjs) — raw material for a skill draft, never injected.
// Zero tokens, nothing written to the project; state lives beside the
// envelope cache under ~/.cache. A hook that fails says so to the person
// (`systemMessage`) and never blocks: a silent hook would look like a pass.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { cacheDirFor } from "../envelope_cache.mjs";
import { threadContexts } from "../thread_context.mjs";
import { runConstraintChecks, workingTreeDelta } from "./check.mjs";
import { appendLesson, fileDiff, offenderFile } from "./lessons.mjs";
import { fitContract, restOfContract } from "./contract_fit.mjs";
import { buildRemitIndex, matchQuestion, applyRoutingBudget } from "../../src/server/thread_remit.ts";
import { buildKeywordIndex, matchKeywords } from "../../src/server/thread_keywords.ts";
import { loadConstraints, formatConstraintsBlock } from "../../src/server/constraint_store.ts";
import { formatContractBlock } from "../../src/server/thread_contract.ts";
import { getThreadSkill, injectableSkillText, readStoredThreadSkill } from "../../src/server/thread_skill_store.ts";
import { affectedTests } from "../../src/shared/test_reach.ts";
import { verbMayGate } from "../../src/server/quality/standings.ts";
import { derivedPolicyClauses } from "../../src/server/policy_check.ts";
import { archForPrompt } from "./arch_context.mjs";
import { languageForFile, shouldSkipDir } from "../../src/server/languages.ts";

export const HOOK_EVENTS = ["session-start", "prompt", "post-edit", "stop"];
const MIN_PROMPT_CHARS = 12;
/** Claude Code keeps hook context inline up to 10,000 characters. */
export const INLINE_CAP = 9500;
/** The share of one prompt's context a ratified skill may take. */
const SKILL_ROOM = 4500;
const HEADER = "VibeGraph (deterministic — derived from the code's IR and the operators' stated rules, not written by a model):";

// ── session state ──────────────────────────────────────────────────────

function sessionFile(absRoot, sessionId) {
  const safe = String(sessionId || "no-session").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return join(cacheDirFor(absRoot), "sessions", `${safe}.json`);
}
function readSession(path) {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return {}; }
}
function writeSession(path, state) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}
/** What the session's context holds. A compaction or /clear empties it. */
function resetDelivery(state) {
  for (const k of ["contracts", "partialContracts", "rules", "injectedSkills", "globalRulesSent", "parseNote", "oriented"]) delete state[k];
}

// ── the inline cap ─────────────────────────────────────────────────────

/** Cut at a line boundary under `room`, and say what was cut and where the
 *  whole of it is. Never a silent truncation. */
export function fitText(text, room, whereFull) {
  if (text.length <= room) return text;
  const note = `\n… (${"{n}"} more characters not shown — the inline limit; ${whereFull})`;
  let cut = text.lastIndexOf("\n", Math.max(0, room - note.length - 12));
  if (cut < room / 3) cut = Math.max(0, room - note.length - 12);
  return text.slice(0, cut) + note.replace("{n}", String(text.length - cut));
}

const capped = (text) => fitText(text, INLINE_CAP, "`vibegraph-knowledge check --uncommitted` or the export has it all");

// ── findings: every non-pass verdict, one per offender ─────────────────

export function findingsOf(checkResult) {
  const out = [];
  for (const row of checkResult.results) {
    if (row.verdict === "pass") continue;
    const offenders = row.offenders.length ? row.offenders : ["-"];
    for (const o of offenders) {
      out.push({
        key: `${row.id}|${row.rule}|${row.verdict}|${o}`,
        id: row.id, rule: row.rule, verdict: row.verdict, offender: o === "-" ? null : o,
        described: row.described, reason: row.reason,
        gates: row.verdict === "violated" && (row.gates ?? verbMayGate(row.rule)),
      });
    }
  }
  return out;
}

/** One block per rule: its stated text (with the reason people wrote), then
 *  each check that failed and where. */
function renderFindings(list, textById) {
  const byId = new Map();
  for (const f of list) { if (!byId.has(f.id)) byId.set(f.id, []); byId.get(f.id).push(f); }
  return [...byId].map(([id, fs]) => [
    `- [${id}] ${textById.get(id) ?? fs[0].described}`,
    ...fs.map((f) => `  check: ${f.described} → ${f.verdict.toUpperCase()}${f.offender ? ` at ${f.offender}` : ""}\n    ${f.reason}`),
  ].join("\n")).join("\n");
}

function check(absRoot, loaded) {
  return runConstraintChecks({ root: absRoot, loaded, uncommitted: true, commit: "working-tree" });
}

/** Files the parser could not read. Said, never swallowed: a rule touching
 *  them reads unverifiable, and a hook that went quiet about it would look
 *  like a pass (the first live run had 17 of them and said nothing). */
function parseNote(loaded) {
  const errs = Object.keys(loaded.parseErrors ?? {});
  const part = Object.keys(loaded.partialParses ?? {});
  const lines = [];
  if (errs.length) {
    const shown = errs.slice(0, 8).join(", ");
    lines.push(`VibeGraph could not parse ${errs.length} file(s) (${shown}${errs.length > 8 ? ", …" : ""}), so nothing is known about them and rules touching them read unverifiable. First error: ${String(loaded.parseErrors[errs[0]]).slice(0, 200)}`);
  }
  // A PARTLY read file has an IR: it is checked, minus the construct the
  // grammar could not read. Said once, never treated as a failure.
  if (part.length) lines.push(`${part.length} file(s) were read only partly — a construct the parser could not read was dropped, the rest is checked: ${part.slice(0, 8).join(", ")}${part.length > 8 ? ", …" : ""}.`);
  return lines.length ? lines.join("\n") : null;
}

// ── session start: orientation ─────────────────────────────────────────

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function orientation(absRoot, loaded, constraints) {
  const env = loaded.envelope;
  const langs = new Map();
  for (const ir of Object.values(env.files)) langs.set(ir.language ?? "?", (langs.get(ir.language ?? "?") ?? 0) + 1);
  const kinds = new Map();
  for (const e of env.entryPoints) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const lines = [
    `This project: ${plural(Object.keys(env.files).length, "parsed source file")} (${[...langs].map(([l, n]) => `${n} ${l}`).join(", ")}); `
      + `${plural(env.entryPoints.length, "entry point")} (${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(", ")}), `
      + `each traced forward as a thread across files.`,
  ];
  if (constraints.length) {
    lines.push("", `Stated rules (${constraints.length}) — from the people who run this code, with their reasons; the checkable ones are re-checked after every edit and a new violation stops the edit:`);
    let used = 0, shown = 0;
    for (const c of constraints) {
      const checks = [...(c.checks ?? []), ...(c.check ? [c.check] : [])].map((x) => x?.rule).filter(Boolean);
      if (derivedPolicyClauses(c, env.files).length) checks.push(`policy ${c.policy.rule}`);
      const who = c.source && c.source !== "human" ? ` · ${c.source}-stated` : "";
      const text = c.text.length > 240 ? `${c.text.slice(0, 237)}…` : c.text;
      const line = `- [${c.id} · ${c.kind}${who}] ${text}${checks.length ? ` (checked: ${checks.join(", ")})` : ""}`;
      if (used + line.length > 5200) break;
      lines.push(line); used += line.length; shown++;
    }
    if (shown < constraints.length) lines.push(`- … ${constraints.length - shown} more: \`vibegraph-knowledge constraints list\``);
  } else {
    lines.push("", "No stated rules yet (`vibegraph-knowledge constraints add` records one, with its reason).");
  }
  const skills = { ratified: [], draft: 0 };
  for (const t of env.threads) {
    if (!t.entryPointId) continue;
    const s = readStoredThreadSkill(absRoot, t.entryPointId);
    if (s?.status === "ratified") skills.ratified.push(t.entryPointId);
    else if (s) skills.draft++;
  }
  lines.push("", skills.ratified.length
    ? `Ratified thread skills (${skills.ratified.length}): ${skills.ratified.slice(0, 12).join(", ")}${skills.ratified.length > 12 ? ", …" : ""} — each arrives when a prompt names its thread.${skills.draft ? ` ${skills.draft} draft(s) await ratification.` : ""}`
    : `No ratified thread skills${skills.draft ? ` (${skills.draft} draft(s) await ratification)` : ""}.`);
  const readme = join(absRoot, ".vibegraph", "knowledge", "README.md");
  if (existsSync(readme)) {
    const hours = Math.round((Date.now() - statSync(readme).mtimeMs) / 3_600_000);
    lines.push(`Knowledge folder: .vibegraph/knowledge/README.md (exported ${hours < 1 ? "within the hour" : `${hours} h ago`}; architecture.md is the one-page map).`);
  } else {
    lines.push("No knowledge folder yet — `vibegraph-knowledge export` writes the architecture map, one contract per thread and the rules.");
  }
  lines.push("", "How this session is wired: name a function or file in a prompt to get its thread's contract, rules and skill; an edit that breaks a checkable rule is stopped with the rule and its reason.");
  return lines.join("\n");
}

function onSessionStart(input, { absRoot, loaded, state, constraints }) {
  const source = String(input.source ?? "startup");
  const out = [];
  if (source === "compact" || source === "clear") {
    resetDelivery(state);
    out.push(source === "compact"
      ? "(The conversation was compacted: thread contracts and rules delivered earlier may be gone from it, so VibeGraph will send them again when a prompt names their code.)"
      : "(New conversation: VibeGraph will send thread contracts and rules again when a prompt names their code.)");
  } else if (state.oriented) {
    return null; // resumed with its context intact
  }
  if (!state.baseline) state.baseline = findingsOf(check(absRoot, loaded)).map((f) => f.key);
  out.unshift(orientation(absRoot, loaded, constraints));
  const pn = parseNote(loaded);
  if (pn) { out.push(pn); state.parseNote = pn; }
  state.oriented = true;
  return { json: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: capped(`${HEADER}\n\n${out.join("\n\n")}`) } } };
}

// ── prompt: routed context ─────────────────────────────────────────────

function onPrompt(input, { absRoot, loaded, state, constraints }) {
  const env = loaded.envelope;
  const out = [];
  let room = INLINE_CAP - HEADER.length - 400;
  if (!state.baseline) state.baseline = findingsOf(check(absRoot, loaded)).map((f) => f.key);
  const pn = parseNote(loaded);
  if (pn && state.parseNote !== pn) { out.push(pn); state.parseNote = pn; room -= pn.length; }

  const prompt = String(input.prompt ?? "");
  const long = prompt.trim().length >= MIN_PROMPT_CHARS;
  const strong = long ? matchQuestion(prompt, buildRemitIndex(env.threads), { limit: 3 }) : [];
  // No code-shaped token: the code's own words, labelled a guess.
  let weak = [];
  if (long && !strong.length) {
    const docOf = (file, id) => (env.files[file]?.nodes ?? []).find((n) => n.id === id)?.docstring ?? null;
    weak = matchKeywords(prompt, buildKeywordIndex(env.threads, docOf), { limit: 2 });
  }
  const matches = strong.length ? strong : weak.map((w) => ({ entryPointId: w.entryPointId, qualifiedName: w.qualifiedName, matchedOn: [], score: w.score, weakTerms: w.terms }));

  if (matches.length) {
    const ctx = threadContexts(env, absRoot, constraints, { only: new Set(matches.map((m) => m.entryPointId)) });
    const candidates = matches.map((m) => {
      const c = ctx.byEntry.get(m.entryPointId);
      const res = c ? getThreadSkill(absRoot, m.entryPointId, c.stamp) : { exists: false };
      const text = res.exists ? injectableSkillText(res) : null;
      return {
        ...m, skillBody: text, sourceHash: text !== null && res.exists ? res.sourceHash : null,
        staleRatified: res.exists && res.status === "ratified" && res.stale && text === null,
        ...(!res.exists ? { skillState: "absent" } : res.status !== "ratified" ? { skillState: "draft" } : {}),
      };
    });
    const applied = applyRoutingBudget(candidates, new Map(Object.entries(state.injectedSkills ?? {})), Math.min(SKILL_ROOM, room));
    const weakBy = new Map(matches.filter((m) => m.weakTerms).map((m) => [m.entryPointId, m.weakTerms]));
    const sentContracts = new Set(state.contracts ?? []);
    const partial = { ...(state.partialContracts ?? {}) };
    const sentRules = new Set(state.rules ?? []);
    const injected = new Map(Object.entries(state.injectedSkills ?? {}));
    const deferred = [];
    const archFor = archForPrompt(absRoot, env, applied.routed.map((r) => r.entryPointId), state, constraints);
    for (const r of applied.routed) {
      const c = ctx.byEntry.get(r.entryPointId);
      const terms = weakBy.get(r.entryPointId);
      const head = terms
        ? `### Possibly related: thread ${r.qualifiedName} (entry point ${r.entryPointId}) — a KEYWORD guess from the words ${terms.map((t) => `"${t}"`).join(", ")}; the prompt named no code, so check this is the right place before relying on it`
        : `### Thread ${r.qualifiedName} (entry point ${r.entryPointId}) — matched on ${r.matchedOn.join(", ")}`;
      const parts = [head];
      const fresh = (c?.routed ?? []).filter((k) => !sentRules.has(k.id));
      const rules = formatConstraintsBlock(fresh);
      if (rules) parts.push(rules);
      const archBefore = JSON.stringify(state.arch ?? null);
      const archLines = archFor(r.entryPointId);
      if (archLines) parts.push(archLines);
      let block = parts.join("\n");
      // Not sent: nothing about it may be remembered as sent.
      if (block.length > room) { state.arch = JSON.parse(archBefore) ?? undefined; deferred.push(r.qualifiedName); continue; }
      room -= block.length;
      for (const k of fresh) sentRules.add(k.id);
      if (r.skill && r.skill.length + 40 <= room) {
        block += `\n## Ratified thread skill\n${r.skill}`;
        room -= r.skill.length + 40;
        const hash = candidates.find((x) => x.entryPointId === r.entryPointId)?.sourceHash;
        if (hash) injected.set(r.entryPointId, hash);
      } else if (r.skill) block += "\n(Its ratified skill did not fit the inline limit this turn; name this thread again to receive it.)";
      else if (r.skillOmitted === "already-in-session") block += "\n(Its ratified skill was already given earlier in this session.)";
      else if (r.skillOmitted === "stale") block += "\n(Its ratified skill is STALE — the thread changed since it was ratified — and is withheld.)";
      else if (r.skillOmitted === "over-budget") block += "\n(Its ratified skill did not fit this turn; name this thread again to receive it.)";
      else if (r.skillMissing) block += `\n(No ratified skill for this thread: ${r.skillMissing === "draft" ? "a draft awaits ratification" : "none drafted"}.)`;
      // A contract is sent whole, or shortened by SECTION (contract_fit.mjs)
      // with what was held back remembered: "partly sent", so the next
      // prompt naming this thread sends the rest instead of "already given".
      const ep = r.entryPointId;
      const held = partial[ep];
      if (c && !sentContracts.has(ep)) {
        const fitted = room > 600 ? fitContract(formatContractBlock(c.contract), room) : null;
        if (fitted) {
          block += `\n${fitted.text}`;
          room -= fitted.text.length + 1;
          sentContracts.add(ep);
          if (fitted.held.length) partial[ep] = fitted.held; else delete partial[ep];
        } else block += "\n(Its contract did not fit the inline limit this turn; name this thread again to receive it.)";
      } else if (c && held?.length) {
        const rest = restOfContract(formatContractBlock(c.contract), held, Math.max(0, room - 200));
        if (rest.text) {
          const t = `\n(The rest of this thread's contract, held back earlier for length:)\n${rest.text}`;
          block += t;
          room -= t.length;
        }
        if (rest.held.length) {
          partial[ep] = rest.held;
          block += "\n(Still more of its contract held back for length; name this thread again, or see the export.)";
        } else delete partial[ep];
        if (rest.stale) block += "\n(Its contract changed since it was first sent; `vibegraph-knowledge export` has the current one.)";
      } else if (c) block += "\n(Its contract was already given earlier in this session.)";
      out.push(block);
    }
    if (deferred.length) out.push(`(Also matched, not sent — over the inline limit: ${deferred.join(", ")}. Name one to receive it.)`);
    state.contracts = [...sentContracts];
    state.partialContracts = partial;
    state.rules = [...sentRules];
    state.injectedSkills = Object.fromEntries(injected);
  } else if (!state.globalRulesSent) {
    // No match at all: the project-wide rules, once. (The no-code arm of the
    // crystal drill routed itself from the constraints file; this puts the
    // global half of it in front of the session.)
    const global = constraints.filter((c) => c.scope?.all && !(state.rules ?? []).includes(c.id));
    const rules = formatConstraintsBlock(global);
    if (rules) {
      out.push(`${rules}\n(This prompt named no code VibeGraph could route to a thread. Name a function or file to get its thread's contract and rules.)`);
      state.rules = [...new Set([...(state.rules ?? []), ...global.map((c) => c.id)])];
    }
    state.globalRulesSent = true;
  }
  state.stopBlocks = 0;
  if (!out.length) return null;
  return { json: { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: capped(`${HEADER}\n\n${out.join("\n\n")}`) } } };
}

// ── edits and stop: enforcement, and lessons ───────────────────────────

/** Record a LESSON for every blocked violation that no longer shows. */
function settlePending(absRoot, state, now, textById, sessionId) {
  const pending = state.pendingBlocks ?? {};
  const live = new Set(now.map((f) => f.key));
  for (const [key, p] of Object.entries(pending)) {
    if (live.has(key)) continue;
    const file = offenderFile(p.offender);
    appendLesson(absRoot, {
      at: new Date().toISOString(), session: sessionId ?? null, ruleId: p.id, ruleText: textById.get(p.id) ?? null,
      check: p.described, offender: p.offender, file, reason: p.reason, blockedAt: p.at,
      diff: file ? fileDiff(absRoot, file) : null,
      note: "the diff is the whole working-tree change to the file when the rule cleared, not only the fix",
    });
    delete pending[key];
  }
  state.pendingBlocks = pending;
}

function remember(state, gating) {
  const pending = state.pendingBlocks ?? {};
  for (const f of gating) pending[f.key] ??= { id: f.id, described: f.described, offender: f.offender, reason: f.reason, at: new Date().toISOString() };
  state.pendingBlocks = pending;
}

function newFindings(absRoot, loaded, state, textById, sessionId) {
  const now = findingsOf(check(absRoot, loaded));
  settlePending(absRoot, state, now, textById, sessionId);
  let note = null;
  if (!state.baseline) {
    // Installed mid-session: what is there now is the baseline.
    state.baseline = now.map((f) => f.key);
    note = "VibeGraph recorded the current findings as this session's baseline; only findings after this point are reported.";
  }
  const base = new Set(state.baseline);
  return { fresh: now.filter((f) => !base.has(f.key)), note };
}

/** A cheap stamp of every source file (path, size, mtime): whether a Bash
 *  command changed code at all. h2h4 found why this matters: a headless
 *  session made all 18 of its tool calls through Bash — `cat >`, `sed -i`,
 *  python — so a hook on Write|Edit alone never saw an edit. */
function sourceStamp(absRoot) {
  const parts = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (!shouldSkipDir(e.name)) walk(full); continue; }
      if (!e.isFile() || !languageForFile(e.name, full)) continue;
      const s = statSync(full);
      parts.push(`${relative(absRoot, full)}:${s.size}:${s.mtimeMs}`);
    }
  };
  walk(absRoot);
  return parts.sort().join("\n");
}

function onPostEdit(input, { absRoot, loaded: load, state, constraints }) {
  // Bash: no file path to key on. Check only when some source file moved.
  if (input.tool_name === "Bash") {
    const stamp = sourceStamp(absRoot);
    if (state.sourceStamp === stamp) return null;
    state.sourceStamp = stamp;
    return afterEdit(null, input, { absRoot, loaded: load(), state, constraints });
  }
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof target !== "string") return null;
  const abs = isAbsolute(target) ? target : resolve(absRoot, target);
  const rel = relative(absRoot, abs).split("\\").join("/");
  if (rel.startsWith("..") || rel.startsWith(".vibegraph/") || !languageForFile(basename(abs), abs)) return null;
  state.sourceStamp = sourceStamp(absRoot);
  return afterEdit(rel, input, { absRoot, loaded: load(), state, constraints });
}

/** After an edit: `rel` is the edited file, or null when a shell command
 *  changed an unknown set (then every changed file's parse and tests). */
function afterEdit(rel, input, { absRoot, loaded, state, constraints }) {
  const textById = new Map(constraints.map((c) => [c.id, c.text]));
  const notes = [];
  let files = rel ? [rel] : [];
  if (!rel) {
    try { files = workingTreeDelta(absRoot).entries.map((e) => e.file).filter((f) => languageForFile(basename(f), join(absRoot, f))); }
    catch { files = []; }
  }
  // Only a file with NO IR blocks: a partly read one is still checked.
  const broken = files.filter((f) => loaded.parseErrors?.[f]);
  if (broken.length) {
    return { block: `VibeGraph could not parse ${broken.join(", ")} after this edit, so no rule can be checked against it: ${String(loaded.parseErrors[broken[0]]).slice(0, 400)}` };
  }
  const partial = files.filter((f) => loaded.partialParses?.[f]);
  if (partial.length) notes.push(`${partial.join(", ")} was read only partly (${loaded.partialParses[partial[0]]}); rules are checked on the rest of it.`);
  const { fresh, note } = newFindings(absRoot, loaded, state, textById, input.session_id);
  if (note) notes.push(note);
  const gating = fresh.filter((f) => f.gates);
  const advisory = fresh.filter((f) => !f.gates);
  if (advisory.length) {
    notes.push(`New since the session began (not blocking — ${advisory.some((f) => f.verdict === "violated") ? "a violation of a rule whose check is advisory until calibrated, or " : ""}a rule the IR could not settle):\n${renderFindings(advisory, textById)}`);
  }
  if (files.length) {
    const what = files.length === 1 ? files[0] : `the ${files.length} changed source files`;
    const tests = affectedTests(loaded.envelope.threads, loaded.envelope.entryPoints, files);
    notes.push(tests.length
      ? `Discovered tests that reach ${what}: ${tests.map((t) => t.entryPointId).join(", ")}`
      : `No discovered test reaches ${what}.`);
  }
  if (!gating.length) return { json: { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: capped(`${HEADER}\n${notes.join("\n\n")}`) } } };
  remember(state, gating);
  return {
    block: capped(`${HEADER}\nThis edit breaks a stated rule. Fix it before going on — the rule and its reason come from the people who run this code:\n${renderFindings(gating, textById)}\n\n${notes.join("\n\n")}`),
  };
}

function onStop(input, { absRoot, loaded, state, constraints }) {
  const textById = new Map(constraints.map((c) => [c.id, c.text]));
  const { fresh } = newFindings(absRoot, loaded, state, textById, input.session_id);
  const gating = fresh.filter((f) => f.gates);
  if (!gating.length) {
    const other = [
      fresh.length ? `VibeGraph: ${fresh.length} new advisory or unverifiable finding(s) this session — run \`vibegraph-knowledge check --uncommitted\`.` : null,
      parseNote(loaded),
    ].filter(Boolean).join("\n");
    return other ? { json: { systemMessage: capped(other) } } : null;
  }
  remember(state, gating);
  const body = renderFindings(gating, textById);
  // At most twice per prompt, and never when Claude is already continuing
  // because of this hook: past that it is said to the person, not looped.
  state.stopBlocks = (state.stopBlocks ?? 0) + 1;
  if (input.stop_hook_active || state.stopBlocks > 2) {
    return { json: { systemMessage: capped(`VibeGraph: the session is ending with ${gating.length} stated-rule violation(s):\n${body}`) } };
  }
  return { block: capped(`${HEADER}\nBefore finishing: the tree now violates a stated rule. Fix it, then finish.\n${body}`) };
}

/** Run one hook. Returns `{json}` to print on exit 0, `{block}` — a reason
 *  for stderr and exit 2, the form Claude Code shows to Claude on both
 *  PostToolUse and Stop — or null for silence. */
export function runHook(event, input, { absRoot, pipeline }) {
  const sessionPath = sessionFile(absRoot, input.session_id);
  const state = readSession(sessionPath);
  try {
    let memo = null;
    const load = () => (memo ??= loadEnvelope(absRoot, null, pipeline ?? {}, { cache: true }));
    const constraints = existsSync(join(absRoot, ".vibegraph", "constraints.json")) ? loadConstraints(absRoot) : [];
    // post-edit loads lazily: a shell command that changed no code costs a
    // stat walk, not a parse.
    const out = event === "session-start" ? onSessionStart(input, { absRoot, loaded: load(), state, constraints })
      : event === "prompt" ? onPrompt(input, { absRoot, loaded: load(), state, constraints })
        : event === "post-edit" ? onPostEdit(input, { absRoot, loaded: load, state, constraints })
          : event === "stop" ? onStop(input, { absRoot, loaded: load(), state, constraints }) : null;
    writeSession(sessionPath, state);
    return out;
  } catch (e) {
    return { json: { systemMessage: `VibeGraph ${event} hook failed, so nothing was checked this time: ${String(e?.message ?? e).slice(0, 300)}` } };
  }
}
