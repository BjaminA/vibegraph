// SOFTWARE SPECS in the running app (2026-09-30): the MCP read tool and the
// Plan panel's messages. Drafting a spec spends tokens and may fetch a URL,
// so it stays on the command line (`vibegraph-knowledge software add`); here
// a person RATIFIES (quotes re-checked against the saved sources first) or
// puts a ratified spec's tool and rules into the plan, and a model READS.

import type { SoftwareSpec } from "../shared/software_types.ts";
import { listSpecs, loadSpec, saveSpec, readSources } from "./software_store.ts";
import { verifyQuotes } from "./software_draft.ts";
import { formatSpecMd, specUsage, specToPlanOps } from "./software_apply.ts";
import { loadPlan, savePlan } from "./plan_store.ts";
import { applyPlanOps } from "./plan_ops.ts";

export interface SoftwareReply { specs: SoftwareSpec[]; error?: string; message?: string }

export function ratifySpec(root: string, tool: string, now: Date = new Date()): { error?: string; message?: string } {
  const spec = loadSpec(root, tool);
  if (!spec) return { error: `no spec for ${tool}` };
  const texts = readSources(root, spec);
  const missing = texts.filter((t) => t.text === null).map((t) => t.ref);
  if (missing.length) return { error: `the saved source text is missing for ${missing.join(", ")} — its quotes cannot be checked` };
  const bad = verifyQuotes(spec, texts.map((t) => t.text));
  if (bad.length) return { error: `these quotes are not in the saved sources: ${bad.join(", ")}` };
  const saved = saveSpec(root, { ...spec, status: "ratified", ratifiedAt: now.toISOString() });
  return saved.error ? { error: saved.error } : { message: `ratified ${tool}` };
}

export function specIntoPlan(root: string, tool: string, params: Record<string, string> = {}, by: "human" | "agent" = "human"): { error?: string; message?: string } {
  const spec = loadSpec(root, tool);
  if (!spec) return { error: `no spec for ${tool}` };
  if (spec.status !== "ratified") return { error: `${tool} is a draft — ratify it first` };
  const plan = loadPlan(root);
  if (!plan) return { error: "no plan yet — start one with its objective" };
  let ops = specToPlanOps(spec, params, { tools: new Set(plan.stack.map((t) => t.tool)), policies: plan.policies });
  if (!ops.length) return { message: `${tool} and its rules are already in the plan, up to date` };
  // A model may not set a status; its update to an agreed rule makes it proposed anyway.
  if (by === "agent") ops = ops.map((o) => (o.op === "update" ? { ...o, fields: Object.fromEntries(Object.entries(o.fields).filter(([k]) => k !== "status")) } : o));
  const r = applyPlanOps(plan, ops, by);
  if (r.error || !r.plan) return { error: r.error };
  const s = savePlan(root, r.plan);
  return s.error ? { error: s.error } : { message: `plan rev ${r.plan.revision}: ${r.changes.join("; ")} — all proposed` };
}

/** WS: software-list | software-ratify {tool} | software-plan {tool}. The sender is a person. */
export function handleSoftwareMessage(root: string, msg: { type: string; payload?: any }): { reply: SoftwareReply; changed: boolean } {
  const tool = typeof msg.payload?.tool === "string" ? msg.payload.tool : "";
  let r: { error?: string; message?: string } = {};
  if (msg.type === "software-ratify") r = ratifySpec(root, tool);
  else if (msg.type === "software-plan") r = specIntoPlan(root, tool);
  else if (msg.type !== "software-list") r = { error: `unknown message ${msg.type}` };
  return { reply: { specs: listSpecs(root), ...r }, changed: msg.type !== "software-list" && !r.error };
}

/** MCP: the specs, or one in full with where this code calls it. */
export function softwareToolText(root: string, tool: string | null, files: Record<string, any> | null): { text: string; error?: string } {
  const specs = listSpecs(root);
  if (!tool) {
    if (!specs.length) return { text: "No software specs (.vibegraph/software/). A person drafts one from the tool's docs: `vibegraph-knowledge software add <tool> --from <url or file>`." };
    return { text: specs.map((s) => `${s.tool} — ${s.status}${s.status === "draft" ? " (NOT ratified: do not rely on it)" : ""}, ${s.role}: ${s.definition}`).join("\n") };
  }
  const spec = specs.find((s) => s.tool === tool);
  if (!spec) return { text: "", error: `no spec for ${tool}` };
  return { text: formatSpecMd(spec, files ? specUsage(spec, files) : undefined) };
}
