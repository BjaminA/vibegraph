// `vibegraph-knowledge constraint show|edit|propose|accept|reject <id>`
// (2026-10-01) — amending a stated rule without deleting it
// (src/server/constraint_edit.ts). `constraints <sub>` works too.
//
//   show <id>               the rule, its history (who / when / before → after)
//                           and any open proposals
//   edit <id> <changes>     a PERSON's change, applied now. Run by an agent
//                           (`--as agent`, or from inside Claude Code) it is
//                           recorded as a PROPOSAL instead — never applied.
//   propose <id> <changes> --why "<reason>"
//                           a proposal, for a person to accept
//   accept <id> <pN>        a person applies proposal pN   (refused from Claude Code)
//   reject <id> <pN>        a person drops it               (refused from Claude Code)
//
// <changes>: --text "…" · --check '<one clause as JSON>' (replaces every
// clause) · --checks '<array>' · --note "…" · scope: --all | --threads a,b |
// --files f,g | --tools t,u (any scope flag replaces the whole scope).
import { loadConstraints } from "../../src/server/constraint_store.ts";
import { editConstraint, proposeConstraintEdit, decideConstraintProposal } from "../../src/server/constraint_edit.ts";
import { isAgentRun } from "./actor.mjs";
import { personName } from "../../src/server/person.ts";

export const AMEND_SUBS = ["show", "edit", "propose", "accept", "reject"];

const list = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** The patch the flags describe, or the reason they do not parse. */
export function patchFromFlags(values) {
  const patch = {};
  if (values.text !== undefined) patch.text = values.text;
  if (values.note !== undefined) patch.note = values.note;
  for (const k of ["check", "checks"]) {
    if (values[k] === undefined) continue;
    try { patch[k] = JSON.parse(values[k]); } catch (e) { return { error: `--${k} is not JSON: ${e.message}` }; }
  }
  if (values.all || values.threads || values.files || values.tools) {
    patch.scope = values.all ? { all: true } : {
      ...(values.threads ? { entryPointIds: list(values.threads) } : {}),
      ...(values.files ? { files: list(values.files) } : {}),
      ...(values.tools ? { stack: list(values.tools) } : {}),
    };
  }
  return { patch };
}

const show = (v) => JSON.stringify(v ?? null);

export function formatHistory(c) {
  const out = [];
  for (const ch of c.changes ?? []) out.push(`    ${ch.at}  ${ch.who ? `${ch.who} (${ch.by})` : ch.by}  ${ch.field}: ${show(ch.before)} → ${show(ch.after)}${ch.why ? `  — ${ch.why}` : ""}`);
  return out;
}

export function formatProposals(c) {
  return (c.proposals ?? []).map((p) => `    ${p.id}  proposed ${p.at} by ${p.by}: ${Object.entries(p.patch).map(([k, v]) => `${k} → ${show(v)}`).join("; ")}\n        why: ${p.why}\n        decide: vibegraph-knowledge constraint accept ${c.id} ${p.id}   ·   … reject ${c.id} ${p.id}`);
}

/** @returns {{ lines: string[], messages: string[], exitCode: number }} */
export function runConstraintAmend({ root, sub, id, pid, values, formatConstraint }) {
  const lines = [];
  if (!id) return { lines, messages: [`${sub} needs a constraint id (see \`constraints list\`)`], exitCode: 2 };
  const agent = values.as === "agent" || isAgentRun();
  if (sub === "show") {
    const c = loadConstraints(root).find((x) => x.id === id);
    if (!c) return { lines, messages: [`no constraint ${id}`], exitCode: 1 };
    if (values.json === true) return { lines: [JSON.stringify(c, null, 2)], messages: [], exitCode: 0 };
    lines.push(formatConstraint(c));
    const h = formatHistory(c);
    lines.push(h.length ? "  history:" : "  history: none — as first stated", ...h);
    const p = formatProposals(c);
    if (p.length) lines.push("  open proposals (a person decides):", ...p);
    return { lines, messages: [], exitCode: 0 };
  }
  if (sub === "accept" || sub === "reject") {
    if (!pid) return { lines, messages: [`${sub} needs the proposal id: constraint ${sub} ${id} p1`], exitCode: 2 };
    const r = decideConstraintProposal(root, id, pid, sub === "accept", { who: personName(root) });
    if (r.error) return { lines, messages: [r.error], exitCode: 1 };
    lines.push(sub === "accept" ? `accepted ${pid}: ${id} now reads` : `rejected ${pid}; ${id} unchanged`, formatConstraint(r.constraint));
    return { lines, messages: [], exitCode: 0 };
  }
  const { patch, error } = patchFromFlags(values);
  if (error) return { lines, messages: [error], exitCode: 2 };
  if (sub === "propose" || (sub === "edit" && agent)) {
    const r = proposeConstraintEdit(root, id, patch, { by: agent ? "agent" : "human", why: values.why ?? "" });
    if (r.error) return { lines, messages: [r.error], exitCode: r.error.startsWith("no constraint") ? 1 : 2 };
    lines.push(`proposed ${r.proposal.id} for ${id}${sub === "edit" ? " (an edit by an agent is recorded as a proposal)" : ""} — the rule is unchanged until a person runs: vibegraph-knowledge constraint accept ${id} ${r.proposal.id}`);
    return { lines, messages: [], exitCode: 0 };
  }
  const r = editConstraint(root, id, patch, { by: "human", who: personName(root), why: values.why });
  if (r.error) return { lines, messages: [r.error], exitCode: r.error.startsWith("no constraint") ? 1 : 2 };
  lines.push(`${id} changed (${r.changed.join(", ")}) — recorded in its history:`, formatConstraint(r.constraint));
  return { lines, messages: [], exitCode: 0 };
}
