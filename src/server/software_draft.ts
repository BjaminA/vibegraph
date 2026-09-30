// Drafting a SOFTWARE SPEC from a tool's documents (2026-09-30) — the prompt,
// the reply parser, and the CITATION GATE that decides what a model's draft
// may keep. The rule is the architecture proposals' (arch_propose.ts): every
// claim quotes what it was shown.
//   - a quote that is NOT in the sources → the item is DROPPED (a fabricated
//     citation is worse than none: it looks like evidence);
//   - an item with no quote (null) → KEPT and labelled INFERRED, so the person
//     ratifying sees which parts are the model's own knowledge.
// Quotes are matched after normalising whitespace, case, markdown and
// typographic punctuation — never paraphrase. Pure: text in, spec out.

import type { SoftwareSpec, SoftwareSource, SoftwareRule } from "../shared/software_types.ts";
import { SOFTWARE_CAPS } from "../shared/software_types.ts";
import { STACK_ROLES } from "../shared/stack_taxonomy.ts";
import { isSafeTool } from "./software_store.ts";

const CHECK_VERBS = ["callers-only", "import-only", "calls-through", "payload-keys", "guards", "not-in-loop", "handles-failure", "annotated", "co-changes"];
const SOURCE_BUDGET = 60_000;

/** A web page to readable text: scripts and styles out, tags to breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|pre|section|article|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/** What a quote and a source are compared as. */
export function normalizeForCite(s: string): string {
  return s.toLowerCase()
    .replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, "-")
    .replace(/[*_`#>|]/g, "").replace(/\s+/g, " ").trim();
}

export function buildSpecPrompt(tool: string, sources: Array<{ ref: string; text: string }>, hint?: string): string {
  let room = SOURCE_BUDGET;
  const docs = sources.map((s, i) => {
    const t = s.text.length > room ? `${s.text.slice(0, Math.max(0, room))}\n[… cut for length]` : s.text;
    room -= t.length;
    return `=== SOURCE ${i + 1}: ${s.ref} ===\n${t}`;
  }).join("\n\n");
  return [
    `You are writing a SOFTWARE SPEC for "${tool}" from its documentation, for a tool that plans and checks code built on it.`,
    "Use ONLY the sources below. Every item carries `cite`: an EXACT quote copied from a source (12–300 characters, verbatim, no paraphrase, no ellipsis inside).",
    "An item the sources do not state may be included only with `cite: null` — it will be shown as INFERRED. A quote that is not in the sources gets the item dropped.",
    "Be minimal: the operations a developer calls, the states things move through (or the options to choose between), the permissions it needs, and the RULES a developer must follow (with why). No marketing.",
    "Mark as `core: true` the few rules (at most 8) that every piece of work on this tool must keep — they are what a coding session is always told; the rest are read on demand.",
    "Record as `unknowns` the questions a developer would need answered that the sources do NOT answer (a version, whether a feature is supported, a limit) — so nobody assumes. Unknowns carry no quote.",
    "A `states` entry is kind \"sequence\" (values a thing moves through, in order) or \"choice\" (options to pick one of).",
    `role is one of: ${STACK_ROLES.filter((r) => r !== "unknown" && r !== "runtime").join(", ")} ("platform" = a backend platform SDK; "db"; "queue"; "http-client"; "model-api"…).`,
    `A rule may carry a check in this grammar, or null: ${CHECK_VERBS.join(", ")} — e.g. {"rule":"calls-through","target":"*.GetBlob","through":"{wait_ready}"}, {"rule":"callers-only","target":"*.PutBlob","files":["{blob_module}"]}. Spell the tool's own API call as "*.Name" (that method on any receiver); write the PROJECT's names as {placeholders}.`,
    "Give a check ONLY when it proves the rule. A check that proves less than the rule says (e.g. that some keys are passed, when the rule is about exactly one of something) gives a false pass, which is worse than no check. A check's target must be one of the tool's own operations.",
    "Reply with ONE JSON object, nothing else:",
    `{"tool":"${tool}","vendor":"…","role":"…","definition":"one or two sentences","definitionCite":"…",`,
    ` "identity":{"packages":["npm/pip/crate names that mean this tool"],"calls":["API names"]},`,
    ` "operations":[{"name":"…","does":"read|write|call|subscribe|admin","on":"what it acts on","cite":"…"}],`,
    ` "states":[{"of":"…","kind":"sequence|choice","values":["…"],"cite":"…"}],`,
    ` "permissions":[{"name":"…","for":"…","cite":"…"}],`,
    ` "rules":[{"id":"s1","text":"one line","why":"the reason (may be longer)","core":true,"cite":"…","check":null}],`,
    ` "unknowns":[{"id":"u1","question":"…","mattersFor":"…"}]}`,
    `Caps: ${SOFTWARE_CAPS.operations} operations, ${SOFTWARE_CAPS.states} states, ${SOFTWARE_CAPS.permissions} permissions, ${SOFTWARE_CAPS.rules} rules (at most ${SOFTWARE_CAPS.core} core), ${SOFTWARE_CAPS.unknowns} unknowns; a rule's text ≤ ${SOFTWARE_CAPS.line} characters, its why ≤ ${SOFTWARE_CAPS.why}.`,
    ...(hint ? [`The person adds: ${hint}`] : []),
    "",
    docs,
  ].join("\n");
}

/** The JSON object in a reply (bare, or fenced), or the reason there is none. */
export function parseSpecReply(text: string): { value?: any; error?: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const body = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!body.trim()) return { error: "the reply holds no JSON object" };
  try { return { value: JSON.parse(body) }; } catch (e: any) { return { error: `the reply's JSON does not parse: ${e.message}` }; }
}

const str = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null);

/** Apply the citation gate and the shape rules; the result is a DRAFT. */
export function gateSpec(raw: any, tool: string, sources: SoftwareSource[], texts: string[], draftedBy: string, now: Date = new Date()): { spec?: SoftwareSpec; error?: string; dropped: string[]; inferred: string[] } {
  const dropped: string[] = [];
  const inferred: string[] = [];
  if (!raw || typeof raw !== "object") return { error: "the reply is not an object", dropped, inferred };
  const hay = normalizeForCite(texts.join("\n\n"));
  // → { keep, cite }: a verified quote, null (inferred), or refused.
  const judge = (where: string, c: unknown): { keep: boolean; cite: string | null } => {
    if (c === null || c === undefined || c === "") { inferred.push(where); return { keep: true, cite: null }; }
    const q = String(c).trim();
    const n = normalizeForCite(q);
    if (n.length < SOFTWARE_CAPS.citeMin) { dropped.push(`${where} — its quote is too short to mean anything ("${q}")`); return { keep: false, cite: null }; }
    if (!hay.includes(n)) { dropped.push(`${where} — its quote is not in the sources ("${q.slice(0, 80)}")`); return { keep: false, cite: null }; }
    return { keep: true, cite: q.slice(0, SOFTWARE_CAPS.cite) };
  };

  const role = STACK_ROLES.includes(raw.role) && raw.role !== "unknown" ? raw.role : null;
  if (!role) return { error: `the draft's role "${String(raw.role)}" is not one of the stack roles`, dropped, inferred };
  const definition = str(raw.definition, SOFTWARE_CAPS.definition);
  if (!definition) return { error: "the draft has no definition", dropped, inferred };
  const def = judge("definition", raw.definitionCite);
  // A definition with a fabricated quote is kept, as INFERRED: the tool needs saying what it is.
  if (!def.keep) inferred.push("definition (its quote was refused)");

  const operations = (Array.isArray(raw.operations) ? raw.operations : []).slice(0, SOFTWARE_CAPS.operations).flatMap((o: any) => {
    const name = str(o?.name, 80);
    if (!name || !/^[\w .:/@<>{}\-]{1,80}$/.test(name)) return [];
    const does = ["read", "write", "call", "subscribe", "admin"].includes(o.does) ? o.does : "call";
    const j = judge(`operation ${name}`, o.cite);
    return j.keep ? [{ name, does, ...(str(o.on, 80) ? { on: str(o.on, 80)! } : {}), ...(str(o.note, SOFTWARE_CAPS.line) ? { note: str(o.note, SOFTWARE_CAPS.line)! } : {}), cite: j.cite }] : [];
  });
  const states = (Array.isArray(raw.states) ? raw.states : []).slice(0, SOFTWARE_CAPS.states).flatMap((s: any) => {
    const of = str(s?.of, 80);
    const values = Array.isArray(s?.values) ? s.values.map((v: unknown) => str(v, 40)).filter(Boolean) : [];
    if (!of || !values.length) return [];
    const j = judge(`states of ${of}`, s.cite);
    return j.keep ? [{ of, values, ...(s.kind === "choice" ? { kind: "choice" as const } : { kind: "sequence" as const }), cite: j.cite }] : [];
  });
  const permissions = (Array.isArray(raw.permissions) ? raw.permissions : []).slice(0, SOFTWARE_CAPS.permissions).flatMap((p: any) => {
    const name = str(p?.name, 80);
    if (!name) return [];
    const j = judge(`permission ${name}`, p.cite);
    return j.keep ? [{ name, ...(str(p.for, 80) ? { for: str(p.for, 80)! } : {}), cite: j.cite }] : [];
  });
  const packages = (Array.isArray(raw.identity?.packages) ? raw.identity.packages : []).filter((p: unknown) => isSafeTool(p)).slice(0, SOFTWARE_CAPS.packages);
  const calls = [...new Set([
    ...(Array.isArray(raw.identity?.calls) ? raw.identity.calls : []).map((c: unknown) => str(c, 80)).filter((c: string | null): c is string => !!c && /^[\w .:/@<>{}\-]{1,80}$/.test(c)),
    ...operations.map((o: { name: string }) => o.name),
  ])].slice(0, SOFTWARE_CAPS.operations);
  let n = 0;
  let core = 0;
  const rules: SoftwareRule[] = (Array.isArray(raw.rules) ? raw.rules : []).slice(0, SOFTWARE_CAPS.rules).flatMap((r: any) => {
    const text = str(r?.text, SOFTWARE_CAPS.line), why = str(r?.why, SOFTWARE_CAPS.why);
    if (!text || !why) return [];
    const id = `s${++n}`;
    const j = judge(`rule ${id} (${text.slice(0, 40)})`, r.cite);
    if (!j.keep) { n--; return []; }
    let check = r.check && typeof r.check === "object" && CHECK_VERBS.includes(r.check.rule) ? r.check : null;
    const off = check ? checkOffTarget(check, calls, packages) : null;
    if (off) { dropped.push(`the check on rule ${id} — ${off} (a check that proves less than its rule gives a false pass)`); check = null; }
    const isCore = r.core === true && core < SOFTWARE_CAPS.core;
    if (isCore) core++;
    return [{ id, text, why, ...(isCore ? { core: true } : {}), cite: j.cite, check }];
  });
  const unknowns = (Array.isArray(raw.unknowns) ? raw.unknowns : []).slice(0, SOFTWARE_CAPS.unknowns).flatMap((u: any, i: number) => {
    const question = str(u?.question, SOFTWARE_CAPS.why);
    return question ? [{ id: `u${i + 1}`, question, ...(str(u.mattersFor, SOFTWARE_CAPS.line) ? { mattersFor: str(u.mattersFor, SOFTWARE_CAPS.line)! } : {}) }] : [];
  });

  const spec: SoftwareSpec = {
    version: "1", tool, ...(str(raw.vendor, 80) ? { vendor: str(raw.vendor, 80)! } : {}), role,
    definition, definitionCite: def.keep ? def.cite : null,
    identity: { packages, calls },
    operations, states, permissions, rules, ...(unknowns.length ? { unknowns } : {}), sources,
    status: "draft", draftedBy, draftedAt: now.toISOString(),
    gate: { dropped, inferred },
  };
  return { spec, dropped, inferred };
}

/** Is a check aimed at the tool? Its target must be one of the tool's own
 *  operations (spelled `Name`, `*.Name` or `lib.Name`) or a project
 *  {placeholder}; an import-only's tool, one of its packages. The reason when
 *  it is not, else null. A check on something else (a CLI command, another
 *  library) cannot prove a rule about THIS tool's use. */
export function checkOffTarget(check: Record<string, unknown>, calls: string[], packages: string[]): string | null {
  const isPlaceholder = (v: string) => /^\{\w+\}$/.test(v);
  const known = new Set(calls);
  if (check.rule === "import-only") {
    const t = String(check.tool ?? "");
    return isPlaceholder(t) || packages.includes(t) ? null : `its tool "${t}" is not one of the tool's packages`;
  }
  if (typeof check.target !== "string") return null;
  const t = check.target;
  if (isPlaceholder(t)) return null;
  const last = t.split(".").pop() ?? t;
  return known.has(last) || known.has(t) ? null : `its target "${t}" is not one of the tool's operations`;
}

/** Re-check a spec's quotes against its saved sources (before ratifying, and
 *  after a person edits the file by hand). */
export function verifyQuotes(spec: SoftwareSpec, texts: Array<string | null>): string[] {
  const hay = normalizeForCite(texts.filter((t): t is string => t !== null).join("\n\n"));
  const bad: string[] = [];
  const check = (where: string, c: string | null) => { if (c !== null && !hay.includes(normalizeForCite(c))) bad.push(where); };
  check("definition", spec.definitionCite);
  for (const o of spec.operations) check(`operation ${o.name}`, o.cite);
  for (const s of spec.states) check(`states of ${s.of}`, s.cite);
  for (const p of spec.permissions) check(`permission ${p.name}`, p.cite);
  for (const r of spec.rules) check(`rule ${r.id}`, r.cite);
  return bad;
}
