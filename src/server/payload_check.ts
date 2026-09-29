// `payload-keys` — the checkable half of a `payload-schema` constraint.
//
// A payload rule used to be prose only: routed to the right threads by the
// IR, read by a model, verified by nothing. The IR already records the KEYS a
// call spells (`argKeys`: object-literal keys in TypeScript, keyword names and
// dict-literal keys in Python, one nested level as `outer.inner`), so "every
// call to `publish` passes `region`" and "no call to `requests.post` sends
// `json.password`" are checkable against the call sites themselves.
//
// The floor is the grammar's: three verdicts, and `unverifiable` is not a
// pass. What makes it honest here is telling ABSENT from NOT VISIBLE. A key
// is absent only where the call spells a literal at that level and the key
// is not in it. It is not visible where the level is:
//
//   - not a literal at all: `post(url, body)`, `json=payload`
//     (the frontend recorded the name `json` and no `json.*` under it),
//   - opened by a spread or a computed key: `{...base}`, `**extra`, `[k]`,
//   - deeper than the one nested level the frontends record.
//
// A required key that is not visible makes that call site unverifiable, never
// violated: a false violation rejects correct work. Values are never read.
//
// Pure over injected facts, like the rest of constraint_grammar.ts.

import type { CheckResult } from "./constraint_grammar.ts";

export interface PayloadKeysCheck {
  rule: "payload-keys";
  /** The call: a project function (`publish`) or a spelled callee
   *  (`requests.post`, `client.callTool`). */
  target: string;
  /** Key paths every call must spell (`region`, `json.device`). */
  require?: string[];
  /** Key paths no call may spell (`json.password`). */
  forbid?: string[];
}

/** One call site with the keys its arguments spell. */
export interface CallSiteFact {
  file: string;
  nodeId: string;
  /** The callee as written (`requests.post`, `publish`). */
  callee: string;
  /** The linker's resolved callee name, when it resolved one. */
  resolvedName: string | null;
  /** Flattened key paths, or null when no argument spells a key. */
  keys: string[] | null;
}

const KEY = /^[^\s.]+(\.[^\s.]+)?$/;

export function isPayloadKeysCheck(v: unknown): v is PayloadKeysCheck {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  if (c.rule !== "payload-keys" || typeof c.target !== "string" || !c.target.trim()) return false;
  const keys = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === "string" && KEY.test(s));
  const hasReq = c.require !== undefined, hasForbid = c.forbid !== undefined;
  if (!hasReq && !hasForbid) return false; // a payload rule that requires and forbids nothing is not a rule
  return (!hasReq || keys(c.require)) && (!hasForbid || keys(c.forbid));
}

/** Flatten an IR node's `argKeys` (one list per argument). */
export function flattenArgKeys(argKeys: unknown): string[] | null {
  if (!Array.isArray(argKeys)) return null;
  const out: string[] = [];
  for (const group of argKeys) {
    if (!Array.isArray(group)) continue;
    for (const k of group) if (typeof k === "string" && !out.includes(k)) out.push(k);
  }
  return out.length ? out : null;
}

const OPENER = /^(\.\.\.|\*\*|\[)/;

/** Can the keys at this level be seen? `prefix` is "" (the top level) or one
 *  key (`json`); deeper levels are never recorded. */
function levelVisible(keys: string[], prefix: string): boolean {
  // A marker opens the level it starts at: `...base` / `**extra` / `[k]` at
  // the top, `json.**extra` under `json`. (Not "has no dot" — a spread's own
  // text starts with dots, which is how the first cut missed `...base`.)
  if (prefix === "") return !keys.some((k) => OPENER.test(k));
  if (prefix.includes(".")) return false;
  const children = keys.filter((k) => k.startsWith(`${prefix}.`)).map((k) => k.slice(prefix.length + 1));
  // The name alone, with nothing under it: the value was not a literal.
  if (!children.length) return false;
  return !children.some((c) => OPENER.test(c));
}

type KeyState = "present" | "absent" | "not-visible";

function keyState(keys: string[] | null, path: string): KeyState {
  if (!keys) return "not-visible";
  if (keys.includes(path)) return "present";
  const segs = path.split(".");
  if (!levelVisible(keys, "")) return "not-visible";
  if (!keys.includes(segs[0])) return "absent";
  // The top-level key is there; the question is inside its value.
  return levelVisible(keys, segs[0]) ? "absent" : "not-visible";
}

export function sitesFor(sites: readonly CallSiteFact[], target: string): CallSiteFact[] {
  return sites.filter((s) => s.resolvedName === target || s.callee === target
    || (target.includes(".") && s.callee.endsWith(`.${target}`)));
}

export function checkPayloadKeys(sites: readonly CallSiteFact[] | undefined, check: PayloadKeysCheck): CheckResult {
  const { target } = check;
  if (!sites) {
    return { verdict: "unverifiable", reason: "no call-site facts were supplied to this check. NOT treated as satisfied.", offenders: [] };
  }
  const hits = sitesFor(sites, target);
  if (!hits.length) {
    return {
      verdict: "unverifiable",
      reason: `the IR has no call to \`${target}\` — the rule may be about code that does not exist yet, or a callee spelled differently. NOT treated as satisfied.`,
      offenders: [],
    };
  }
  const offenders: string[] = [];
  const problems: string[] = [];
  const hidden: string[] = [];
  for (const s of hits) {
    const at = `${s.file}:${s.nodeId}`;
    const missing: string[] = [], unseen: string[] = [], sent: string[] = [];
    for (const k of check.require ?? []) {
      const st = keyState(s.keys, k);
      if (st === "absent") missing.push(k);
      else if (st === "not-visible") unseen.push(k);
    }
    for (const k of check.forbid ?? []) {
      const st = keyState(s.keys, k);
      if (st === "present") sent.push(k);
      else if (st === "not-visible") unseen.push(k);
    }
    if (missing.length || sent.length) {
      offenders.push(at);
      problems.push(`${at} ${[
        ...(missing.length ? [`does not pass ${missing.map((k) => `\`${k}\``).join(", ")}`] : []),
        ...(sent.length ? [`passes ${sent.map((k) => `\`${k}\``).join(", ")}`] : []),
      ].join(" and ")}`);
    } else if (unseen.length) {
      hidden.push(`${at} (${unseen.map((k) => `\`${k}\``).join(", ")} not visible: ${s.keys ? "a spread, computed key or non-literal value" : "no literal keys at this call"})`);
    }
  }
  if (offenders.length) {
    return { verdict: "violated", reason: `${problems.join("; ")}.`, offenders };
  }
  if (hidden.length) {
    return {
      verdict: "unverifiable",
      reason: `no call to \`${target}\` breaks the rule where its keys are visible, but ${hidden.length} of ${hits.length} call site(s) do not show them: ${hidden.join("; ")}.`,
      offenders: [],
    };
  }
  return {
    verdict: "pass",
    reason: `all ${hits.length} call site(s) of \`${target}\` satisfy it (keys read from the literal arguments at each call; values not checked; calls the linker could not name as \`${target}\` were not followed)`,
    offenders: [],
  };
}

export function describePayloadKeys(check: PayloadKeysCheck): string {
  const parts = [
    ...(check.require?.length ? [`passes ${check.require.map((k) => `\`${k}\``).join(", ")}`] : []),
    ...(check.forbid?.length ? [`never passes ${check.forbid.map((k) => `\`${k}\``).join(", ")}`] : []),
  ];
  return `every call to \`${check.target}\` ${parts.join(" and ")}`;
}
