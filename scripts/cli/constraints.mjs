// `vibegraph-knowledge constraints` (2026-09-25) — the stated rules from the
// command line. `.vibegraph/constraints.json` is the file the drills found
// load-bearing (h2h2, h2h3, M-CRYSTAL: the arm with the rules wrote correct
// code, the arm without broke one), and until now only the GUI, the MCP tool
// and `classify --apply` could write it. Zero tokens.
//
//   constraints list [<root>] [--json]
//   constraints add [<root>] --kind <k> --text "<sentence>" (--all | --threads a,b | --files f,g | --tools t,u)
//                   [--note "<why>"] [--check '<json>'] [--policy '<json>']
//   constraints add [<root>] --json '<full constraint object>'
//   constraints remove <id> [<root>]
//   constraints ratify <id> [<root>]      an agent- or orchestrator-stated rule becomes human-stated
//
// Whoever runs the command is the human: `add` stores source "human", the
// same rule `architecture --ratify` follows. Everything goes through the one
// validator the GUI and MCP use (validateConstraintInput), so a malformed
// check is refused here exactly as it is there, and a restatement of an
// existing rule is refused as a duplicate rather than stored as a twin.
import {
  CONSTRAINT_KINDS, addConstraint, findDuplicate, isClassification, loadConstraints, removeConstraintAndDemote, saveConstraints, validateConstraintInput,
} from "../../src/server/constraint_store.ts";
import { describeCheck, isConstraintCheck } from "../../src/server/constraint_grammar.ts";
import { describeRun1Check, isRun1Check } from "../../src/server/quality/verbs/index.ts";
import { actorNote, actorOf } from "./actor.mjs";
import { ratifyConstraint } from "../../src/server/constraint_edit.ts";
import { personName } from "../../src/server/person.ts";
import { AMEND_SUBS, runConstraintAmend } from "./constraint_amend.mjs";
import { checkStatedRules } from "../../src/server/constraint_report.ts";
import { loadEnvelope } from "../quality_check.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStackIndex } from "../../src/server/stack.ts";
import { harvestRules, formatHarvest } from "../../src/server/rule_harvest.ts";
import { runRuleDraft } from "./rule_draft.mjs";
import { runRuleLedgerCli } from "./rule_ledger_cli.mjs";

export const CONSTRAINTS_USAGE = `constraint(s) list|add|harvest|ledger|restore|draft|remove|ratify|show|edit|propose|accept|reject [...]   the stated rules (.vibegraph/constraints.json); zero tokens except draft
      list [<root>] [--json]
      harvest [<root>] [--min <score>] [--all] [--json]
          rule-shaped sentences in the project's own prose (CLAUDE.md, READMEs, docs, module headers,
          docstrings) that name code the IR knows, ranked; a place to read, never a rule — state the
          operators' real ones with add --cite, or let /vibegraph-rules do it for you to ratify
      ledger [<root>] [--json]
          every rule sentence of a CLAUDE.md / AGENTS.md rule section and what became of it
          (ratified, proposed, merged, next draft, queued behind a round's cap, out of reach),
          and any entry of constraints.json this version could not read
      restore [<root>] [--all | --take 1,3]
          the rules a person ratified before that constraints.json no longer holds; listed,
          or put back with --all / --take (a person's step)
      draft [<root>] [--dry-run] [--reply <file>] [--prompt] [--model <m>] [--force]
          SPENDS TOKENS (one model call): rules proposed from the architecture — the processes, the
          tools by role, the funnels, the hops, silent-fail settings, unguarded flows, the harvest
          and the census, side by side. Each must cite what it was shown; its scope must use the
          project's spellings; its check is run first. Survivors are stored agent-stated for a person.
          Refused while 12 or more proposals already wait for review (--force overrides)
      add [<root>] --kind <${CONSTRAINT_KINDS.join("|")}> --text "<the rule, with its reason>"
          scope: --all | --threads <entry ids> | --files <paths> | --tools <names>   (comma-separated)
          [--note "<why>"] [--check '<json>'] [--policy '<json>']   or the whole object: --json '<object>'
          [--cite <file>:<line> [--quote "<the sentence>"]]   the prose it was read from; refused unless it is there
          [--as agent]   stated by a model: labelled so and waits for a person (also implied inside Claude Code)
          a check is run against the code first: UNVERIFIABLE is refused (store anyway: --force);
          --dry-run shows the verdict and stores nothing
      remove <id> [<root>]
      ratify <id> [<root>]    an agent- or orchestrator-stated rule becomes human-stated
      show <id> [--json]      the rule, its history (who, when, before → after) and open proposals
      edit <id> <changes> [--why "…"]      a person's change, applied now and recorded; from an agent
                                           (--as agent, or inside Claude Code) it becomes a proposal
      propose <id> <changes> --why "…"     a change for a person to accept; the rule stands meanwhile
      accept|reject <id> <pN>              a person decides a proposal
          <changes>: --text · --check '<clause>' (replaces every clause) · --checks '<array>' · --note · a scope flag`;

const list = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function parseJson(label, text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (e) { return { ok: false, error: `${label} is not JSON: ${e.message}` }; }
}

const checkText = (c) => (isConstraintCheck(c) ? describeCheck(c) : isRun1Check(c) ? describeRun1Check(c) : "unknown check shape");

export function formatConstraint(c) {
  const scope = c.scope.all ? "all" : [
    c.scope.entryPointIds?.length ? `threads ${c.scope.entryPointIds.join(", ")}` : "",
    c.scope.files?.length ? `files ${c.scope.files.join(", ")}` : "",
    c.scope.stack?.length ? `tools ${c.scope.stack.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  const lines = [`${c.id}  [${c.source}${c.source === "human" ? "" : " · NOT human-reviewed"}] ${c.kind} · ${scope}`, `    ${c.text}`];
  if (c.note) lines.push(`    note: ${c.note}`);
  if (c.cite) lines.push(`    from: ${c.cite.file}:${c.cite.line} — "${c.cite.quote.length > 120 ? `${c.cite.quote.slice(0, 117)}…` : c.cite.quote}"`);
  if (c.policy) lines.push(`    policy: ${c.policy.rule} ${c.policy.tool}${c.policy.with ? ` → ${c.policy.with}` : ""}${c.policy.role ? ` (role ${c.policy.role})` : ""}`);
  for (const k of [c.check, ...(c.checks ?? [])].filter(Boolean)) lines.push(`    check: ${checkText(k)}`);
  return lines.join("\n");
}

/** The citation gate: the quoted words must appear in the file within a few
 *  lines of the cited one (whitespace-insensitive; markdown emphasis, bullets
 *  and backticks ignored). Returns the line they start on and the WHOLE
 *  sentence they sit in, read from the file — a live drill cited fragments
 *  ("is a correctness setting, not a"), and a cite is worth most as the
 *  sentence, so the sentence is what is stored. */
export function citedAt(root, cite) {
  let text;
  try { text = readFileSync(resolve(root, cite.file), "utf-8"); } catch { return { ok: false, error: `--cite names ${cite.file}, which cannot be read` }; }
  // a markdown table row reads as its cells joined by " — " (what `harvest` shows), never across rows
  const isRow = (s) => /^\s*\|/.test(s);
  const plain = (s) => (isRow(s) ? s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean).join(" — ") : s)
    // emphasis marks go; an identifier's own underscores (`insert_readings`) stay
    .replace(/[`*]/g, "").replace(/(^|\s)_+|_+(?=\s|$|[.,;:)])/g, "$1").replace(/^\s*(?:[-*+]|\d+\.|#+|\/\/|#|\*)\s*/, "").replace(/\s+/g, " ").trim();
  const want = plain(cite.quote).toLowerCase();
  if (want.length < 12) return { ok: false, error: "--quote wants the sentence (at least a dozen characters), not a word" };
  const lines = text.split(/\r?\n/);
  const lo = Math.max(0, cite.line - 4), hi = Math.min(lines.length, cite.line + 3);
  const parts = [];
  for (let i = lo; i < hi; i++) { const p = plain(lines[i]); if (p && !/^(-+ — )*-+$/.test(p)) parts.push({ text: p, line: i + 1, row: isRow(lines[i]) }); }
  const joined = parts.map((p) => p.text).join(" ");
  const at = joined.toLowerCase().indexOf(want);
  if (at < 0) return { ok: false, error: `the cited sentence is not in ${cite.file} near line ${cite.line} — a rule cites what the prose says, verbatim` };
  // the part the match starts in; a table row is a unit of its own
  let acc = 0, hit = parts[0];
  for (const p of parts) { if (acc + p.text.length >= at + 1) { hit = p; break; } acc += p.text.length + 1; }
  const floor = hit.row ? acc : 0, ceil = hit.row ? acc + hit.text.length : joined.length;
  // the sentence around the match: back to the previous sentence end, forward to the next
  let start = at, end = Math.min(at + want.length, ceil);
  while (start > floor && !/[.!?]\s$/.test(joined.slice(Math.max(0, start - 2), start))) start--;
  while (end < ceil && !/[.!?](\s|$)/.test(joined.slice(end - 1, end + 1))) end++;
  const sentence = joined.slice(start, end).trim().slice(0, 400);
  return { ok: true, line: hit.line, quote: sentence };
}

/** `constraints harvest`: rule-shaped sentences in the project's prose that name code the IR knows (rule_harvest.ts). */
function harvest(root, values, pipeline) {
  const { absRoot, envelope } = loadEnvelope(root, undefined, pipeline ?? {}, { cache: true });
  const report = harvestRules(absRoot, envelope, buildStackIndex(envelope, absRoot), { min: values.min ? Number(values.min) : undefined });
  if (values.json) return { lines: [JSON.stringify(report, null, 2)], messages: [], exitCode: 0 };
  return { lines: [formatHarvest(report, { min: values.min ? Number(values.min) : undefined, all: !!values.all }).trimEnd()], messages: [], exitCode: 0 };
}

/** A new rule's checks against the code as it is now (the `check` loop). */
function precheck(root, value, source, pipeline) {
  try {
    const { absRoot, envelope } = loadEnvelope(root, undefined, pipeline ?? {});
    return checkStatedRules({ envelope, root: absRoot, constraints: [{ ...value, id: "new", source, createdAt: new Date().toISOString() }] });
  } catch (e) {
    return { results: [{ verdict: "unverifiable", described: "the project", reason: `could not parse it to check (${e.message})` }] };
  }
}

/** @returns {{ lines: string[], messages: string[], exitCode: number }} */
export function runConstraints({ root, sub, id, values, pipeline }) {
  const lines = [];
  const messages = [];
  if (sub === "list") {
    const all = loadConstraints(root);
    if (values.json) lines.push(JSON.stringify(all, null, 2));
    else if (!all.length) lines.push("no stated constraints (.vibegraph/constraints.json) — add one with `constraints add`");
    else {
      // 2026-10-17 — rules first; classifications file tools and decide nothing
      const rules = all.filter((c) => !isClassification(c)), filed = all.filter(isClassification);
      if (!rules.length) lines.push("no stated rules");
      for (const c of rules) lines.push(formatConstraint(c));
      if (filed.length) {
        lines.push("", `tool classifications (${filed.length}) — not rules: how a tool no table knew was filed`);
        for (const c of filed) lines.push(`${c.id}  [${c.source}${c.source === "human" ? "" : " · NOT human-reviewed"}] ${c.policy.tool} → ${c.policy.role}`);
      }
    }
    return { lines, messages, exitCode: 0 };
  }
  if (sub === "harvest") {
    try { return harvest(root, values, pipeline); } catch (e) { return { lines, messages: [`harvest: ${e.message}`], exitCode: 2 }; }
  }
  if (sub === "draft") {
    try { return runRuleDraft({ root, values, pipeline }); } catch (e) { return { lines, messages: [`draft: ${e.message}`], exitCode: 2 }; }
  }
  // RC5 — what became of each written rule; the ratified rules a re-init lost
  if (sub === "ledger" || sub === "restore") {
    try { return runRuleLedgerCli({ root, sub, values, pipeline }); } catch (e) { return { lines, messages: [`${sub}: ${e.message}`], exitCode: 2 }; }
  }
  if (sub === "add") {
    let raw;
    if (values.json) {
      const j = parseJson("--json", values.json);
      if (!j.ok) return { lines, messages: [j.error], exitCode: 2 };
      raw = j.value;
    } else {
      const scope = values.all ? { all: true } : {
        ...(values.threads ? { entryPointIds: list(values.threads) } : {}),
        ...(values.files ? { files: list(values.files) } : {}),
        ...(values.tools ? { stack: list(values.tools) } : {}),
      };
      raw = { kind: values.kind, text: values.text, scope, ...(values.note ? { note: values.note } : {}) };
      for (const k of ["check", "policy"]) {
        if (!values[k]) continue;
        const j = parseJson(`--${k}`, values[k]);
        if (!j.ok) return { lines, messages: [j.error], exitCode: 2 };
        raw[k] = j.value;
      }
    }
    // 2026-10-17 — a rule read from the project's prose cites its sentence:
    // --cite file:line [--quote "…"] (the quote defaults to the text). The
    // sentence must be IN that file, near that line — the software-spec rule:
    // a quote not in the source drops the item; here it refuses the rule.
    if (values.cite) {
      const m = /^(.+?):(\d+)$/.exec(values.cite);
      if (!m) return { lines, messages: ["refused: --cite wants <file>:<line>"], exitCode: 2 };
      raw.cite = { file: m[1], line: Number(m[2]), quote: values.quote ?? raw.text ?? "" };
    }
    const v = validateConstraintInput(raw);
    if (!v.ok) return { lines, messages: [`refused: ${v.error}`], exitCode: 2 };
    if (v.value.cite) {
      const where = citedAt(root, v.value.cite);
      if (!where.ok) return { lines, messages: [`refused: ${where.error}`], exitCode: 2 };
      v.value.cite = { file: v.value.cite.file, line: where.line, quote: where.quote };
    }
    const twin = findDuplicate(loadConstraints(root), v.value.text);
    if (twin) return { lines, messages: [`refused: it restates ${twin.id} ("${twin.text.slice(0, 80)}") — edit or remove that one instead`], exitCode: 1 };
    // Run by Claude Code (actor.mjs): the rule is the model's, labelled so,
    // until a person ratifies it — the same label an MCP-stated rule carries.
    // …or says so itself (--as agent, the flag `edit` already takes): a model
    // stating a rule is an agent wherever it runs — a Windows Claude Code
    // calling the CLI through wsl.exe does not carry CLAUDECODE across, so
    // "human" also needs a terminal (actorOf, the person's-step rule).
    const source = values.as === "agent" ? "agent" : actorOf();
    // 2026-10-07 (field report) — a check is evaluated BEFORE it is stored: a
    // rule that cannot be checked was only found on its first `check`, and
    // fixing it took a proposal and a person's accept.
    const pre = v.value.check || v.value.checks?.length ? precheck(root, v.value, source, pipeline) : null;
    // 2026-10-17 (a live drill stored a rule under --dry-run because it had no check to run): a dry run stores nothing, check or not
    if (values["dry-run"] && !pre) return { lines: [`dry run — nothing stored. Would store as ${source}-stated:`, formatConstraint({ ...v.value, id: "(new)", source })], messages, exitCode: 0 };
    if (pre) {
      for (const r of pre.results) lines.push(`  ${r.verdict.toUpperCase()} — ${r.described}: ${r.reason}`);
      const unverifiable = pre.results.filter((r) => r.verdict === "unverifiable");
      if (values["dry-run"]) return { lines: ["dry run — nothing stored. Against the current code:", ...lines], messages, exitCode: pre.results.some((r) => r.verdict === "violated") ? 1 : unverifiable.length ? 2 : 0 };
      if (unverifiable.length && !values.force) {
        return { lines, messages: ["refused: this check is UNVERIFIABLE against the current code (above) — fix the spelling, or store it anyway with --force"], exitCode: 2 };
      }
    }
    const c = addConstraint(root, v.value, source);
    lines.unshift(`stated ${c.id} (${source}${source === "agent" ? " — a person ratifies it with `constraints ratify`" : ""}):`, formatConstraint(c), ...(pre ? ["against the current code:"] : []));
    if (pre?.results.some((r) => r.verdict === "violated")) messages.push(`note: the code VIOLATES ${c.id} today — \`check\` will fail until the offenders above are fixed`);
    if (values.as !== "agent" && actorNote()) messages.push(actorNote());
    return { lines, messages, exitCode: 0 };
  }
  if (sub === "remove") {
    if (!id) return { lines, messages: ["remove needs an id (see `constraints list`)"], exitCode: 2 };
    const r = removeConstraintAndDemote(root, id);
    if (!r.removed) return { lines, messages: [`no constraint ${id}`], exitCode: 1 };
    lines.push(`removed ${id}${r.demoted.length ? ` — the plan's ${r.demoted.join(", ")} (promoted into it) ${r.demoted.length === 1 ? "is a planned rule" : "are planned rules"} again, agreed and no longer enforced` : ""}`);
    return { lines, messages, exitCode: 0 };
  }
  if (sub === "ratify") {
    if (!id) return { lines, messages: ["ratify needs an id (see `constraints list`)"], exitCode: 2 };
    // One function for the CLI and the GUI's Rules panel; the history names who.
    const r = ratifyConstraint(root, id, { who: personName(root) });
    if (r.error) return { lines, messages: [r.error], exitCode: 1 };
    lines.push(`${id} is now human-stated (was ${r.was}-stated) — whoever ran this command reviewed it`, formatConstraint(r.constraint));
    return { lines, messages, exitCode: 0 };
  }
  if (AMEND_SUBS.includes(sub)) return runConstraintAmend({ root, sub, id, pid: values.pid, values, formatConstraint });
  return { lines, messages: [`unknown constraints subcommand: ${sub ?? "(none)"} — list, add, remove, ratify, show, edit, propose, accept or reject`], exitCode: 2 };
}
