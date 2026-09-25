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
  CONSTRAINT_KINDS, addConstraint, findDuplicate, loadConstraints, removeConstraint, saveConstraints, validateConstraintInput,
} from "../../src/server/constraint_store.ts";
import { describeCheck, isConstraintCheck } from "../../src/server/constraint_grammar.ts";
import { describeRun1Check, isRun1Check } from "../../src/server/quality/verbs/index.ts";

export const CONSTRAINTS_USAGE = `constraints list|add|remove|ratify [...]   the stated rules (.vibegraph/constraints.json); zero tokens
      list [<root>] [--json]
      add [<root>] --kind <${CONSTRAINT_KINDS.join("|")}> --text "<the rule, with its reason>"
          scope: --all | --threads <entry ids> | --files <paths> | --tools <names>   (comma-separated)
          [--note "<why>"] [--check '<json>'] [--policy '<json>']   or the whole object: --json '<object>'
      remove <id> [<root>]
      ratify <id> [<root>]    an agent- or orchestrator-stated rule becomes human-stated`;

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

/** @returns {{ lines: string[], messages: string[], exitCode: number }} */
export function runConstraints({ root, sub, id, values }) {
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
    const c = addConstraint(root, v.value, "human");
    lines.push(`stated ${c.id} (human):`, formatConstraint(c));
    return { lines, messages, exitCode: 0 };
  }
  if (sub === "remove") {
    if (!id) return { lines, messages: ["remove needs an id (see `constraints list`)"], exitCode: 2 };
    if (!removeConstraint(root, id)) return { lines, messages: [`no constraint ${id}`], exitCode: 1 };
    lines.push(`removed ${id}`);
    return { lines, messages, exitCode: 0 };
  }
  if (sub === "ratify") {
    if (!id) return { lines, messages: ["ratify needs an id (see `constraints list`)"], exitCode: 2 };
    const all = loadConstraints(root);
    const c = all.find((x) => x.id === id);
    if (!c) return { lines, messages: [`no constraint ${id}`], exitCode: 1 };
    if (c.source === "human") return { lines, messages: [`${id} is already human-stated`], exitCode: 1 };
    const was = c.source;
    c.source = "human";
    saveConstraints(root, all);
    lines.push(`${id} is now human-stated (was ${was}-stated) — whoever ran this command reviewed it`, formatConstraint(c));
    return { lines, messages, exitCode: 0 };
  }
  return { lines, messages: [`unknown constraints subcommand: ${sub ?? "(none)"} — list, add, remove or ratify`], exitCode: 2 };
}
