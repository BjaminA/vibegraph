// RULE CLAIMS, decided against the IR (2026-10-22, the root-cause handoff RC1:
// "Verify before you store"). A model's statement about the code arrives as a
// typed claim (src/shared/rule_claim_types.ts) and is decided here, from facts the
// parse already holds, never from prose:
//
//   runs-only     the commands a file or function runs (command crossings)
//   writes-only   the fields a function writes (assignment targets, update keys)
//   imports-only  the project modules a scope imports (the stack's bindings)
//   never-calls   network / fs / db / subprocess / a tool / a function, over a scope
//   reaches       the tools a scope's calls leave through
//
// Three verdicts, the grammar's honesty: VERIFIED as written; CONTRADICTED,
// with the observed set (a corrected claim) or the counterexamples (and, over
// a folder, the scope narrowed to the files that keep it); UNVERIFIABLE when
// the code holds nothing the claim could be decided on, which is never a pass.
// Pure: the caller builds the facts once (claimFactsFor) and asks many times.

import { claimInWords, type ClaimCheck, type ClaimPredicate } from "../shared/rule_claim_types.ts";
import { jstsPackageName, pythonToolName } from "../shared/stack_taxonomy.ts";
import { flattenArgKeys } from "./payload_check.ts";
import { buildCrossingIndex } from "./crossings.ts";

interface IrNode {
  id: string; type: string; line?: number; name?: string; targetText?: string;
  funcName?: string; callTarget?: string; effectKind?: string | null; argKeys?: unknown;
}
export interface ClaimEnv {
  files: Record<string, { nodes?: IrNode[]; language?: string }>;
  entryPoints: Array<{ id: string; file: string; irNodeId: string }>;
}
interface CrossingLike { kind?: string; file: string; nodeId: string; line?: number; path: string; targets: Array<{ route?: string }> }
interface StackLike {
  importsByFile?: Record<string, Array<{ binding: string; spec: string; project?: boolean }>>;
  tools: Array<{ tool: string; role: string }>;
}

export interface ClaimFacts {
  env: ClaimEnv;
  commands: Array<{ file: string; nodeId: string; line?: number; ran: string }>;
  importsByFile: NonNullable<StackLike["importsByFile"]>;
  roleOf: Map<string, string>;
}

export interface ClaimVerdict {
  verdict: "verified" | "contradicted" | "unverifiable";
  reason: string;
  /** what the code shows: the set an "only" claim is compared with, or what a scope reaches */
  observed?: string[];
  counterexamples?: Array<{ file: string; line?: number; what: string }>;
  /** a contradicted claim the code can correct: the set replaced, or the scope narrowed */
  corrected?: ClaimCheck;
}

/** The roles whose calls cross the network (stack_taxonomy roles). */
const NETWORK_ROLES = new Set(["http-client", "model-api", "platform", "remote", "cloud", "agent-protocol"]);

export function claimFactsFor(env: ClaimEnv, crossings: { all: CrossingLike[] } | null, stack: StackLike): ClaimFacts {
  const commands = (crossings?.all ?? []).filter((c) => c.kind === "command").map((c) => ({
    file: c.file, nodeId: c.nodeId, ...(c.line ? { line: c.line } : {}),
    // a resolved command names the parsed file it runs; an unresolved one, its literal
    ran: c.targets.length === 1 && c.targets[0].route ? c.targets[0].route : c.path,
  }));
  return { env, commands, importsByFile: stack.importsByFile ?? {}, roleOf: new Map(stack.tools.map((t) => [t.tool, t.role])) };
}

/** The facts from a parsed envelope: the one way the gate, `check` and the hooks build them. */
export function claimFactsFromEnvelope(env: { files: Record<string, unknown>; entryPoints?: unknown[] }, stack: StackLike): ClaimFacts {
  return claimFactsFor({ files: env.files as ClaimEnv["files"], entryPoints: (env.entryPoints ?? []) as ClaimEnv["entryPoints"] },
    buildCrossingIndex(env as never), stack);
}

// ── the subject: files, a folder, a function, an entry point ──
interface Subject { files: string[]; fns: Map<string, string[]>; unknown: string[] }

function resolveSubject(subjects: readonly string[], f: ClaimFacts): Subject {
  const all = Object.keys(f.env.files);
  const files = new Set<string>();
  const fns = new Map<string, string[]>();
  const unknown: string[] = [];
  for (const raw of subjects) {
    const s = raw.trim().replace(/^\.\//, "");
    const colon = s.lastIndexOf(":");
    const file = colon > 0 ? s.slice(0, colon) : "";
    if (file && f.env.files[file]) {
      const name = s.slice(colon + 1).replace(/\(\)$/, "");
      const [cls, fn] = name.includes(".") ? name.split(".", 2) : [null, name];
      const ids = (f.env.files[file].nodes ?? []).filter((n) => n.type === "function_def" && n.name === fn && (!cls || n.id.includes(`${cls}.class/`))).map((n) => n.id);
      if (ids.length) { files.add(file); fns.set(file, [...(fns.get(file) ?? []), ...ids]); continue; }
      unknown.push(raw); continue;
    }
    if (f.env.files[s]) { files.add(s); continue; }
    const dir = s.endsWith("/") ? s : `${s}/`;
    const under = all.filter((p) => p.startsWith(dir));
    if (under.length) { for (const p of under) files.add(p); continue; }
    const ep = f.env.entryPoints.find((e) => e.id === s);
    if (ep && f.env.files[ep.file]) { files.add(ep.file); if (ep.irNodeId && ep.irNodeId !== "module") fns.set(ep.file, [...(fns.get(ep.file) ?? []), ep.irNodeId]); continue; }
    unknown.push(raw);
  }
  return { files: [...files].sort(), fns, unknown };
}

const within = (sub: Subject, file: string, nodeId: string) => {
  if (!sub.files.includes(file)) return false;
  const ids = sub.fns.get(file);
  return !ids || ids.some((id) => nodeId === id || nodeId.startsWith(`${id}/`));
};
const nodesIn = (sub: Subject, f: ClaimFacts) =>
  sub.files.flatMap((file) => (f.env.files[file]?.nodes ?? []).filter((n) => within(sub, file, n.id)).map((n) => ({ file, n })));

// ── matching a stated object to an observed one ──
const base = (p: string) => p.split("/").pop() ?? p;
const noExt = (p: string) => p.replace(/\.[A-Za-z0-9]+$/, "");
function same(obj: string, obs: string): boolean {
  const o = obj.trim().replace(/^\.\//, "");
  return obs === o || obs.endsWith(`/${o}`) || base(obs) === o || noExt(base(obs)) === o || noExt(obs) === o;
}
/** either way round: a script run by a bare literal (`"export.py"`, which no one file
 *  answers to) is the `tools/export.py` a claim names, and the reverse */
const matches = (a: string, b: string) => same(a, b) || same(b, a);
const covered = (objects: readonly string[], obs: string) => objects.some((o) => matches(o, obs));

/** The field a write names: `rec["sources"]`, `rec.sources`, `this.sources`; a bare local is no field. */
export function writtenKey(n: Pick<IrNode, "name" | "targetText">): string | null {
  const t = (n.targetText ?? n.name ?? "").trim();
  if (!t || t === "?" || /^[A-Za-z_$][\w$]*$/.test(t)) return null;
  const sub = /\[\s*(["'`])([^"'`]+)\1\s*\]\s*$/.exec(t);
  if (sub) return sub[2];
  const attr = /\.([A-Za-z_$][\w$]*)$/.exec(t);
  return attr ? attr[1] : null;
}

const calleeOf = (n: IrNode) => n.funcName ?? n.callTarget ?? "";

/** The tool a call leaves through, by its import binding; null for project code or a local. */
function toolOfCall(f: ClaimFacts, file: string, callee: string): string | null {
  const head = callee.split(/[.(]/)[0];
  if (!head) return null;
  const b = (f.importsByFile[file] ?? []).find((x) => x.binding === head);
  if (!b || b.project) return null;
  const lang = f.env.files[file]?.language;
  return lang === "jsts" ? jstsPackageName(b.spec) : pythonToolName(b.spec);
}

function hits(f: ClaimFacts, file: string, n: IrNode, obj: string): boolean {
  if (n.type !== "call" && !(n.type === "assignment" && n.callTarget)) return false;
  const callee = calleeOf(n);
  const want = obj.trim();
  if (want === "network" || want === "http") {
    if (n.effectKind === "http") return true;
    const tool = toolOfCall(f, file, callee);
    return !!tool && NETWORK_ROLES.has(f.roleOf.get(tool) ?? "");
  }
  if (["fs", "db", "subprocess", "log"].includes(want)) return n.effectKind === want;
  if (toolOfCall(f, file, callee) === want) return true;
  return callee === want || callee.endsWith(`.${want}`) || callee.split(".")[0] === want;
}

const uniq = (xs: string[]) => [...new Set(xs)].sort();

/** Decide one claim against the code. */
export function checkClaim(c: Pick<ClaimCheck, "predicate" | "subject" | "objects">, f: ClaimFacts): ClaimVerdict {
  const sub = resolveSubject(c.subject, f);
  if (!sub.files.length) return { verdict: "unverifiable", reason: `${c.subject.join(", ")} names nothing parsed` };
  const claim = (over: Partial<ClaimCheck>): ClaimCheck => ({ rule: "claim", predicate: c.predicate, subject: [...c.subject], objects: [...c.objects], ...over });
  const p: ClaimPredicate = c.predicate;

  if (p === "runs-only" || p === "writes-only") {
    const observed = p === "runs-only"
      ? uniq(f.commands.filter((x) => within(sub, x.file, x.nodeId)).map((x) => x.ran))
      : uniq(nodesIn(sub, f).flatMap(({ n }) => {
        if (n.type === "assignment") { const k = writtenKey(n); return k ? [k] : []; }
        if (n.type === "call" && /\.update$/.test(calleeOf(n))) return flattenArgKeys(n.argKeys) ?? [];
        return [];
      }));
    if (!observed.length) return { verdict: "unverifiable", reason: p === "runs-only" ? `the code shows no command that ${c.subject.join(", ")} runs` : `the code shows no field that ${c.subject.join(", ")} writes` };
    const extra = observed.filter((o) => !covered(c.objects, o));
    const missing = c.objects.filter((o) => !observed.some((x) => matches(o, x)));
    if (!extra.length && !missing.length) return { verdict: "verified", reason: `${claimInWords(c)}: the code agrees`, observed };
    const said = [extra.length ? `it also ${p === "runs-only" ? "runs" : "writes"} ${extra.join(", ")}` : "", missing.length ? `it never ${p === "runs-only" ? "runs" : "writes"} ${missing.join(", ")}` : ""].filter(Boolean).join("; ");
    return { verdict: "contradicted", reason: said, observed, corrected: claim({ objects: observed, was: [...c.objects] }) };
  }

  if (p === "imports-only") {
    const seen = sub.files.flatMap((file) => (f.importsByFile[file] ?? []).filter((b) => b.project).map((b) => ({ file, what: b.spec })));
    if (!seen.length) return { verdict: "unverifiable", reason: `${c.subject.join(", ")} imports none of the project's own modules` };
    const inside = (spec: string) => c.objects.some((o) => { const t = o.replace(/\/$/, ""); return spec === t || spec.startsWith(`${t}.`) || spec.startsWith(`${t}/`) || spec.replace(/\./g, "/").startsWith(t); });
    return judgeScope(c, sub, seen.filter((x) => !inside(x.what)), uniq(seen.map((x) => x.what)), claim);
  }

  if (p === "never-calls") {
    const bad = nodesIn(sub, f).filter(({ file, n }) => c.objects.some((o) => hits(f, file, n, o))).map(({ file, n }) => ({ file, ...(n.line ? { line: n.line } : {}), what: calleeOf(n) }));
    return judgeScope(c, sub, bad, undefined, claim);
  }

  // reaches: every named tool is one the scope's calls leave through
  const reached = uniq(nodesIn(sub, f).flatMap(({ file, n }) => {
    const t = n.type === "call" || n.callTarget ? toolOfCall(f, file, calleeOf(n)) : null;
    return t ? [t] : [];
  }));
  const unreached = c.objects.filter((o) => !reached.includes(o) && !nodesIn(sub, f).some(({ file, n }) => hits(f, file, n, o)));
  return unreached.length
    ? { verdict: "contradicted", reason: `nothing in ${c.subject.join(", ")} reaches ${unreached.join(", ")}`, observed: reached }
    : { verdict: "verified", reason: `${claimInWords(c)}: the code agrees`, observed: reached };
}

/** A scoped claim's verdict from its counterexamples; over several files, the files that keep it. */
function judgeScope(c: Pick<ClaimCheck, "predicate" | "subject" | "objects">, sub: Subject, bad: Array<{ file: string; line?: number; what: string }>,
  observed: string[] | undefined, claim: (over: Partial<ClaimCheck>) => ClaimCheck): ClaimVerdict {
  if (!bad.length) return { verdict: "verified", reason: `${claimInWords(c)}: no file in scope breaks it`, ...(observed ? { observed } : {}) };
  const where = bad.slice(0, 3).map((b) => `${b.file}${b.line ? `:${b.line}` : ""} (${b.what})`).join(", ");
  const clean = sub.files.filter((file) => !bad.some((b) => b.file === file));
  const narrowable = sub.files.length > 1 && clean.length > 0 && !sub.fns.size;
  return {
    verdict: "contradicted", reason: `${where}${bad.length > 3 ? ` and ${bad.length - 3} more` : ""}`, counterexamples: bad, ...(observed ? { observed } : {}),
    ...(narrowable ? { corrected: claim({ subject: clean, wasSubject: [...c.subject] }) } : {}),
  };
}

/** A rule's text with a corrected claim: the corrected sentence first, then the
 *  model's other sentences, the ones that never named the set it got wrong. */
export function correctedText(text: string, corrected: ClaimCheck): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const named = (s: string) => (corrected.was ?? []).some((o) => s.includes(o) || s.includes(base(o)) || s.includes(noExt(base(o))));
  const kept = sentences.filter((s) => !named(s));
  return [`${claimInWords(corrected)}.`, ...kept].join(" ");
}

/** A cheap self-consistency pass, for a claim the code could not decide: an
 *  "only" claim whose own reason names a file of the same kind it leaves out. */
export function whyContradicts(c: Pick<ClaimCheck, "predicate" | "objects">, why: string): string | null {
  if (c.predicate !== "runs-only") return null;
  const named = uniq(why.match(/[\w./-]+\.(?:py|sh|bash|mjs|cjs|js|ts)\b/g) ?? []);
  const left = named.filter((x) => !covered(c.objects, x));
  return left.length ? `its own reason names ${left.join(", ")}, which the claim leaves out` : null;
}
