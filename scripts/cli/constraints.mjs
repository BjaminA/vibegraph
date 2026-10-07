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
  CONSTRAINT_KINDS, addConstraint, findDuplicate, loadConstraints, removeConstraintAndDemote, saveConstraints, validateConstraintInput,
} from "../../src/server/constraint_store.ts";
import { describeCheck, isConstraintCheck } from "../../src/server/constraint_grammar.ts";
import { describeRun1Check, isRun1Check } from "../../src/server/quality/verbs/index.ts";
import { isAgentRun } from "./actor.mjs";
import { ratifyConstraint } from "../../src/server/constraint_edit.ts";
import { personName } from "../../src/server/person.ts";
import { AMEND_SUBS, runConstraintAmend } from "./constraint_amend.mjs";
import { checkStatedRules } from "../../src/server/constraint_report.ts";
import { loadEnvelope } from "../quality_check.mjs";

export const CONSTRAINTS_USAGE = `constraint(s) list|add|remove|ratify|show|edit|propose|accept|reject [...]   the stated rules (.vibegraph/constraints.json); zero tokens
      list [<root>] [--json]
      add [<root>] --kind <${CONSTRAINT_KINDS.join("|")}> --text "<the rule, with its reason>"
          scope: --all | --threads <entry ids> | --files <paths> | --tools <names>   (comma-separated)
          [--note "<why>"] [--check '<json>'] [--policy '<json>']   or the whole object: --json '<object>'
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
  if (c.policy) lines.push(`    policy: ${c.policy.rule} ${c.policy.tool}${c.policy.with ? ` → ${c.policy.with}` : ""}${c.policy.role ? ` (role ${c.policy.role})` : ""}`);
  for (const k of [c.check, ...(c.checks ?? [])].filter(Boolean)) lines.push(`    check: ${checkText(k)}`);
  return lines.join("\n");
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
    else for (const c of all) lines.push(formatConstraint(c));
    return { lines, messages, exitCode: 0 };
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
    const v = validateConstraintInput(raw);
    if (!v.ok) return { lines, messages: [`refused: ${v.error}`], exitCode: 2 };
    const twin = findDuplicate(loadConstraints(root), v.value.text);
    if (twin) return { lines, messages: [`refused: it restates ${twin.id} ("${twin.text.slice(0, 80)}") — edit or remove that one instead`], exitCode: 1 };
    // Run by Claude Code (actor.mjs): the rule is the model's, labelled so,
    // until a person ratifies it — the same label an MCP-stated rule carries.
    const source = isAgentRun() ? "agent" : "human";
    // 2026-10-07 (field report) — a check is evaluated BEFORE it is stored: a
    // rule that cannot be checked was only found on its first `check`, and
    // fixing it took a proposal and a person's accept.
    const pre = v.value.check || v.value.checks?.length ? precheck(root, v.value, source, pipeline) : null;
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
