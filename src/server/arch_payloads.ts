// M-ARCH.3 (PLAN-M-ARCH.md) — the PAYLOAD lens: what crosses an edge, read
// from what already exists and nothing invented.
//
//   caller   (derived) — the literal call text at the site, and the KEYS of
//            any object literal it passes (`{ token, amount }`, recorded by
//            the builder as `argKeys`; Python's keyword names as `kwargs`).
//            Keys, never values: a value is a run's business.
//   callee   (derived) — the target entry's own signature from its contract:
//            parameters with their annotations, and what it returns.
//   stated   — a `payload-schema` constraint scoped to either end: what a
//            person says the shape must keep.
//   observed — what a consented trace run SAW dispatched at the call site.
//            NAMED LIMIT: observations record which callee ran, never the
//            argument values, so "observed" here is dispatch, not payload.
//
// Pure. Every record says its source; the view renders one chip per source.

import type { ArchPayloadRecord, ArchRef } from "../shared/protocol.ts";
import type { ThreadContract } from "./thread_contract.ts";

const MAX_TEXT = 160;

export interface PayloadNodeLike {
  id?: string;
  type?: string;
  funcName?: string;
  callTarget?: string;
  args?: string[];
  argKeys?: string[][];
  kwargs?: Record<string, unknown> | string[];
  preview?: string;
  literals?: string[];
  name?: string;
}

function clip(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > MAX_TEXT ? one.slice(0, MAX_TEXT - 1) + "…" : one;
}

/** The keys an IR node's call spells: object-literal keys (TS), keyword
 *  names (Python). Deduped, in source order. */
export function payloadKeys(n: PayloadNodeLike): string[] {
  const out: string[] = [];
  for (const group of n.argKeys ?? []) for (const k of group) if (!out.includes(k)) out.push(k);
  const kw = Array.isArray(n.kwargs) ? n.kwargs : n.kwargs && typeof n.kwargs === "object" ? Object.keys(n.kwargs) : [];
  for (const k of kw) if (typeof k === "string" && !out.includes(k)) out.push(k);
  return out;
}

/** The caller's side of one crossing or call site. */
export function callerPayload(n: PayloadNodeLike | null, ref: ArchRef): ArchPayloadRecord | null {
  if (!n) return null;
  const callee = n.funcName ?? n.callTarget ?? "";
  let text: string;
  if (callee && n.args?.length) text = `${callee}(${n.args.join(", ")})`;
  else if (n.type === "assignment" && n.literals?.length) text = `${n.name ?? "?"} = … ${n.literals.map((l) => JSON.stringify(l)).join(", ")}`;
  else if (n.preview) text = n.preview;
  else if (callee) text = `${callee}(…)`;
  else return null;
  const keys = payloadKeys(n);
  return { side: "caller", source: "derived", text: clip(text), ...(keys.length ? { keys } : {}), where: ref };
}

/** A script's POSITIONAL inputs, read from its top-level assignments that
 *  take an argv slot: `REGION="${1:-all}"` → `REGION ← ${1:-all}`,
 *  `const region = process.argv[2] ?? "all"` → `region ← process.argv[2]`,
 *  `x = sys.argv[1]`. A script has no parameter list; this is its signature. */
const ARGV = /\$\{?[1-9][^}\s"]*\}?|\$@|process\.argv\[\d+\]|sys\.argv\[\d+\]/;
export function scriptArgv(nodes: Array<{ type?: string; name?: string; preview?: string; parentId?: string | null }>): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type !== "assignment" || n.parentId || !n.name || typeof n.preview !== "string") continue;
    const m = ARGV.exec(n.preview);
    if (m && !out.some((x) => x.startsWith(`${n.name} `))) out.push(`${n.name} ← ${m[0]}`);
  }
  return out.slice(0, 8);
}

/** The callee's side: the target thread's own signature — or, for a script
 *  seeded on its module, the argv slots its top level reads. */
export function calleePayload(
  c: ThreadContract | null, ref: ArchRef,
  targetNodes?: Array<{ type?: string; name?: string; preview?: string; parentId?: string | null }>,
): ArchPayloadRecord | null {
  if (!c?.interface) return null;
  if (!c.interface.params.length && targetNodes) {
    const argv = scriptArgv(targetNodes);
    if (argv.length) {
      return { side: "callee", source: "derived", text: clip(`argv: ${argv.join(", ")}`), keys: argv.map((a) => a.split(" ")[0]), where: ref };
    }
  }
  const params = c.interface.params.length ? c.interface.params.join(", ") : "";
  const ret = c.interface.returns
    ?? (c.interface.returnPreviews.length ? c.interface.returnPreviews.slice(0, 2).join(" | ") : null);
  const text = `${c.qualifiedName.split(":").pop()}(${params}) → ${ret ?? "no declared or literal return"}`;
  return {
    side: "callee", source: "derived", text: clip(text), where: ref,
    ...(c.interface.params.length ? {} : { note: "no parameters: a script reads argv/env, a route its request" }),
  };
}

export interface PayloadConstraintLike {
  id: string;
  kind: string;
  text: string;
  source: string;
  scope: { all?: boolean; entryPointIds?: string[]; files?: string[] };
}

/** Stated `payload-schema` rules scoped to either end of an edge. */
export function statedPayloads(
  constraints: PayloadConstraintLike[], threads: string[], files: string[],
): ArchPayloadRecord[] {
  const out: ArchPayloadRecord[] = [];
  for (const c of constraints) {
    if (c.kind !== "payload-schema") continue;
    const s = c.scope;
    const hit = s.all
      || (s.entryPointIds ?? []).some((e) => threads.includes(e))
      || (s.files ?? []).some((f) => files.some((x) => f.endsWith("/") ? x.startsWith(f) : x === f));
    if (!hit) continue;
    out.push({ side: "stated", source: "stated", text: clip(c.text), note: `${c.id} · ${c.source}-stated` });
  }
  return out;
}

/** What a trace run saw dispatched at a call site (dispatch, not values). */
export function observedPayload(
  obs: Array<{ callees: Array<{ callee: string; count: number }>; entryPointId: string; at: string; stale: boolean }>,
  ref: ArchRef,
): ArchPayloadRecord | null {
  if (!obs.length) return null;
  const o = obs[0];
  const text = o.callees.map((c) => `${c.callee}${c.count > 1 ? ` ×${c.count}` : ""}`).join(", ");
  return {
    side: "observed", source: "observed", text: clip(`dispatched to ${text}`), where: ref,
    note: `trace of ${o.entryPointId} at ${o.at}${o.stale ? " — STALE, the file changed since" : ""}; runs record dispatch, not argument values`,
  };
}

/** The label a Payloads lens puts on an edge: the caller's keys when the
 *  code spells them, else its call text. */
export function payloadSummary(p: ArchPayloadRecord[], prefer?: string): string | null {
  const callers = p.filter((x) => x.side === "caller");
  // Keys first (the shape spelled out), then the call that goes THROUGH the
  // tool (`fetch(…)`, not `res.json()` on its result), then the first.
  const caller = callers.find((x) => x.keys?.length)
    ?? (prefer ? callers.find((x) => x.text.startsWith(`${prefer}(`) || x.text.includes(`.${prefer}(`)) : undefined)
    ?? callers[0];
  if (!caller) return null;
  if (caller.keys?.length) return `{ ${caller.keys.slice(0, 4).join(", ")}${caller.keys.length > 4 ? ", …" : ""} }`;
  return caller.text.length > 48 ? caller.text.slice(0, 47) + "…" : caller.text;
}
