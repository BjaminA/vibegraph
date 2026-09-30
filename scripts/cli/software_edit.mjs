// `software edit | rule | unknown` (2026-09-30): changing a spec after it was
// drafted — the whole file in $EDITOR, or one rule / one unknown from the
// command line. Every route goes through src/server/software_edit.ts: the
// quotes are re-checked against the saved documents, what changed is marked
// with who changed it, and a ratified spec stays ratified only when a PERSON
// edits it (Claude Code running this is a model: its edit sends the spec back
// to draft — actor.mjs).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySpecEdit, editRule, editUnknown } from "../../src/server/software_edit.ts";
import { isAgentRun } from "./actor.mjs";

export const SOFTWARE_EDIT_HELP = `  edit <tool>        the whole spec in $EDITOR; on save every quote is re-checked, what you changed is marked
                     as yours, and a ratified spec stays ratified (a model's edit sends it back to draft)
  rule add <tool> --text "…" --why "…" [--check '<json>'] [--core] [--cite "exact quote"]
  rule update <tool> --id s3 [--text …] [--why …] [--check '<json>'|null] [--core|--not-core] [--cite …|null]
  rule remove <tool> --id s3
  unknown add <tool> --question "what the docs do not say" [--matters "what it decides"]
  unknown remove <tool> --id u2`;

function report(r, done) {
  if (r.error) return done(`refused, nothing written: ${r.error}`, 1);
  if (!r.changes.length) return done("no change");
  const s = r.spec;
  return done(`${s.tool}: ${r.changes.join("; ")} — ${s.status === "ratified" ? "still ratified (a person's edit)" : "a DRAFT: a person ratifies it (software ratify)"}`);
}

export function runSoftwareEdit({ root, spec, action, sub, values, done, env = process.env }) {
  const by = isAgentRun(env) ? "agent" : "human";
  if (action === "edit") {
    const dir = mkdtempSync(join(tmpdir(), "vg-spec-"));
    const file = join(dir, `${spec.tool.replace(/[@/]/g, "_")}.json`);
    writeFileSync(file, JSON.stringify(spec, null, 2) + "\n");
    const editor = env.VISUAL || env.EDITOR || "nano";
    const [cmd, ...args] = editor.split(/\s+/);
    const r = spawnSync(cmd, [...args, file], { stdio: "inherit", env });
    if (r.error || r.status !== 0) return done(`the editor (${editor}) did not finish cleanly — nothing written; your copy is at ${file}`, 1);
    let after;
    try { after = JSON.parse(readFileSync(file, "utf-8")); } catch (e) { return done(`not valid JSON (${e.message}) — nothing written; your copy is at ${file}`, 1); }
    const out = applySpecEdit(root, spec, after, by);
    return out.error ? done(`refused, nothing written: ${out.error}\nyour copy is at ${file} — fix it and run: vibegraph-knowledge software edit ${spec.tool}`, 1) : report(out, done);
  }
  const parseCheck = (v) => {
    if (v === undefined) return { value: undefined };
    if (v === "null") return { value: null };
    try { return { value: JSON.parse(v) }; } catch (e) { return { error: `--check is not JSON: ${e.message}` }; }
  };
  if (action === "rule") {
    if (!["add", "update", "remove"].includes(sub)) return done("rule add|update|remove <tool> …", 2);
    const c = parseCheck(values.check);
    if (c.error) return done(c.error, 2);
    const e = editRule(spec, sub, {
      id: values.id, text: values.text, why: values.why, check: c.value,
      core: values.core ? true : values["not-core"] ? false : undefined,
      cite: values.cite === "null" ? null : values.cite,
    });
    return e.error ? done(`refused: ${e.error}`, 2) : report(applySpecEdit(root, spec, e.next, by), done);
  }
  if (action === "unknown") {
    if (!["add", "remove"].includes(sub)) return done("unknown add|remove <tool> …", 2);
    const e = editUnknown(spec, sub, { id: values.id, question: values.question, mattersFor: values.matters });
    return e.error ? done(`refused: ${e.error}`, 2) : report(applySpecEdit(root, spec, e.next, by), done);
  }
  return done(`unknown edit action ${action}`, 2);
}
