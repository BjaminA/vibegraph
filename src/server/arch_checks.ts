// ARCHITECTURE checks (2026-10-01): decisions about the shape of the code
// that lived only in prose — "the decision logic must not import the
// transport" — as checkable verbs of the constraint grammar. Same three
// verdicts as every other verb: a pass says what it could not see, a
// violation names the file and line, and what cannot be checked is
// UNVERIFIABLE, never a pass.
//
//   single-writer  only these functions (or files) call the store's write
//           functions for a zone / document family; a write whose zone or
//           family is computed, outside them, is unverifiable
//   always-with    every path through function X also calls Y (an audit
//           event on every decision): a call to Y outside any branch or loop,
//           with no `return` before it; both arms of an if count
//   id-scheme      ids for family F are produced only by function G: each
//           write of F passes G's result (directly, or through a name G
//           bound in the same function); an id built inline from F's name is
//           a violation, an id from a parameter is unverifiable
//   layer   the files of a layer may import only what `mayImport` names:
//           project folders / globs, or package names (`zod`, `@acme/*`).
//           Standard-library imports are allowed unless `allowStdlib: false`.
//           Read from the project import graph (src/server/import_graph.ts).
//
// New verbs are ADVICE until calibrated (quality/standings.ts, the
// payload-keys precedent): a violation is reported, and blocks nothing, until
// a calibration record says it may.

import type { ImportEdge } from "./import_graph.ts";
import { calleeIs, enclosingName, familyMatches, literalOf } from "./call_args.ts";
import { pathAllowed, describeAllowList } from "../shared/path_match.ts";
import { NODE_BUILTIN_NAMES, PYTHON_STDLIB_CURRENT } from "../shared/stack_stdlib.generated.ts";

export interface LayerCheck {
  rule: "layer";
  /** the layer: folders (trailing /), globs or files */
  files: string[];
  /** what it may import: project folders / globs, or package names (`@acme/*` a scope) */
  mayImport: string[];
  /** standard-library imports allowed (default true) */
  allowStdlib?: boolean;
}

export interface ArchCheckFacts {
  importEdges?: ImportEdge[];
  /** the raw IR per file — the authority verbs read call nodes and their arguments */
  irFiles?: Record<string, any>;
  /** the DECLARED topology (src/server/topology_store.ts) — the topology rules read it */
  topology?: import("../shared/topology_types.ts").TopologyModel;
  /** every parsed file — a layer with none is unverifiable, one importing nothing passes */
  parsedFiles?: string[];
}

interface Result { verdict: "pass" | "violated" | "unverifiable"; reason: string; offenders: string[] }

const strs = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === "string" && s.length > 0);

export function isLayerCheck(c: Record<string, unknown>): boolean {
  return c.rule === "layer" && strs(c.files) && Array.isArray(c.mayImport) && (c.mayImport as unknown[]).every((s) => typeof s === "string" && s.length > 0)
    && (c.allowStdlib === undefined || typeof c.allowStdlib === "boolean");
}

const NODE_STD = new Set(NODE_BUILTIN_NAMES.map((n) => n.replace(/^node:/, "")));
const PY_STD = new Set(PYTHON_STDLIB_CURRENT);
const isStdlib = (pkg: string) => pkg.startsWith("node:") || NODE_STD.has(pkg.split("/")[0]) || PY_STD.has(pkg.split(".")[0]);

/** Is a package name allowed by `mayImport`? `@acme/*` is a scope. */
function packageAllowed(pkg: string, may: readonly string[]): boolean {
  return may.some((m) => m === pkg || (m.endsWith("/*") && pkg.startsWith(m.slice(0, -1))) || pkg.startsWith(`${m}/`));
}

export function checkLayer(facts: ArchCheckFacts, check: LayerCheck): Result {
  const edges = facts.importEdges;
  if (!edges) return { verdict: "unverifiable", reason: "no import graph was supplied to this check — NOT treated as satisfied", offenders: [] };
  const inLayer = (f: string) => pathAllowed(f, check.files);
  const mine = edges.filter((e) => inLayer(e.from));
  const layerFiles = new Set([...(facts.parsedFiles ?? []).filter(inLayer), ...mine.map((e) => e.from)]);
  if (!layerFiles.size) return { verdict: "unverifiable", reason: `no parsed file in ${describeAllowList(check.files)} — nothing to check yet; NOT treated as satisfied`, offenders: [] };
  const offenders: string[] = [];
  for (const e of mine) {
    if (e.to !== null || e.workspace !== undefined) {
      const target = e.to ?? `${e.workspace}/`;
      if (inLayer(target) || pathAllowed(target, check.mayImport)) continue;
      offenders.push(`${e.from}:${e.line} imports ${e.spec} (${target})`);
      continue;
    }
    const pkg = e.pkg ?? e.spec;
    if (packageAllowed(pkg, check.mayImport)) continue;
    if (check.allowStdlib !== false && isStdlib(pkg)) continue;
    offenders.push(`${e.from}:${e.line} imports ${e.spec}`);
  }
  const unseen = "a dynamic import() / require of a computed path is not in the graph";
  return offenders.length
    ? { verdict: "violated", reason: `${describeLayer(check)}: ${offenders.length} import(s) outside it — ${offenders.slice(0, 5).join("; ")}${offenders.length > 5 ? `; +${offenders.length - 5} more` : ""}`, offenders }
    : { verdict: "pass", reason: `${describeLayer(check)}: every import of ${layerFiles.size} file(s) is allowed (${unseen})`, offenders: [] };
}

export function describeLayer(c: LayerCheck): string {
  return `${describeAllowList(c.files)} may import only ${c.mayImport.length ? c.mayImport.join(", ") : "itself"}${c.allowStdlib === false ? " (no standard library)" : " (and the standard library)"}`;
}

/** The current import graph of a set of files, as a STARTING proposal for
 *  their layer rule: every project folder (two segments deep) and package
 *  they import today, outside themselves. */
export function currentLayer(edges: ImportEdge[], files: readonly string[]): { mayImport: string[]; seen: number } {
  const mine = edges.filter((e) => pathAllowed(e.from, files));
  const out = new Set<string>();
  for (const e of mine) {
    if (e.to !== null || e.workspace !== undefined) {
      const t = e.to ?? `${e.workspace}/`;
      if (pathAllowed(t, files)) continue;
      out.add(`${t.split("/").slice(0, Math.max(1, Math.min(2, t.split("/").length - 1))).join("/")}/`);
    } else if (!isStdlib(e.pkg ?? e.spec)) out.add(e.pkg ?? e.spec);
  }
  return { mayImport: [...out].sort(), seen: mine.length };
}

// ── authority: single-writer, always-with, id-scheme ────────────────────

export interface SingleWriterCheck {
  rule: "single-writer";
  /** the store's write functions (`writeDoc`) */
  writes: string[];
  /** the target: a zone name and/or document families (`verdict`, `orders/*`) */
  zone?: string;
  families?: string[];
  /** who may: enclosing functions (`recordVerdict`, `Store.put`) and/or files / folders / globs */
  by?: string[];
  files?: string[];
}

export interface AlwaysWithCheck { rule: "always-with"; target: string; with: string }

export interface IdSchemeCheck {
  rule: "id-scheme";
  family: string;
  /** the functions that may produce its ids */
  producers: string[];
  /** the store's write functions (`writeDoc`) */
  writes: string[];
  /** 0-based: which argument of a write is the id (default: any argument) */
  idArg?: number;
}

/** Is this enclosing function one of the names? `save` matches `Store.save`; `Store.save` only itself. */
const fnIn = (fn: string, names: readonly string[]) => names.some((n) => fn === n || fn.endsWith(`.${n}`));

export function isAuthorityCheck(c: Record<string, unknown>): boolean {
  if (c.rule === "single-writer") {
    return strs(c.writes) && (typeof c.zone === "string" || strs(c.families)) && (strs(c.by) || strs(c.files))
      && (c.zone === undefined || (typeof c.zone === "string" && !!c.zone)) && (c.families === undefined || strs(c.families))
      && (c.by === undefined || strs(c.by)) && (c.files === undefined || strs(c.files));
  }
  if (c.rule === "always-with") return typeof c.target === "string" && !!c.target && typeof c.with === "string" && !!c.with;
  if (c.rule === "id-scheme") return typeof c.family === "string" && !!c.family && strs(c.producers) && strs(c.writes) && (c.idArg === undefined || (Number.isInteger(c.idArg) && (c.idArg as number) >= 0));
  return false;
}

function calls(facts: ArchCheckFacts, names: readonly string[]): Array<{ file: string; n: any }> {
  const out: Array<{ file: string; n: any }> = [];
  for (const [file, ir] of Object.entries(facts.irFiles ?? {})) {
    for (const n of (ir?.nodes ?? []) as any[]) if (n.type === "call" && calleeIs(String(n.callTarget ?? n.funcName ?? ""), names)) out.push({ file, n });
  }
  return out;
}
const loc = (file: string, n: any) => `${file}:${n.line} ${enclosingName(n.id)}`;

export function checkSingleWriter(facts: ArchCheckFacts, c: SingleWriterCheck): Result {
  if (!facts.irFiles) return { verdict: "unverifiable", reason: "no IR was supplied to this check — NOT treated as satisfied", offenders: [] };
  const fams = c.families ?? [];
  const targets = (lits: string[]) => lits.some((l) => (c.zone !== undefined && l === c.zone) || fams.some((f) => familyMatches(f, l)));
  const allowed = (file: string, fn: string) => (!!c.by?.length && fnIn(fn, c.by)) || (!!c.files?.length && pathAllowed(file, c.files));
  const sites = calls(facts, c.writes);
  const offenders: string[] = [];
  const unknown: string[] = [];
  let ours = 0;
  for (const { file, n } of sites) {
    const args: string[] = (n.args ?? []).map(String);
    const lits = args.map(literalOf).filter((x): x is string => x !== null);
    const fn = enclosingName(n.id);
    if (targets(lits)) { if (allowed(file, fn)) ours++; else offenders.push(loc(file, n)); continue; }
    // No literal at all — its zone and family are both computed: it could be a
    // write here. (One naming ANOTHER zone or family as a literal is not.)
    if (args.length && !lits.length && !allowed(file, fn)) unknown.push(`${loc(file, n)} (zone/family computed)`);
  }
  const what = `${c.zone ? `zone ${c.zone}` : ""}${c.zone && fams.length ? " / " : ""}${fams.length ? `family ${fams.join(", ")}` : ""}`;
  const who = [...(c.by ?? []), ...(c.files ?? [])].join(", ");
  if (offenders.length) return { verdict: "violated", reason: `only ${who} may write ${what}: also written at ${offenders.slice(0, 5).join("; ")}`, offenders };
  if (!sites.length) return { verdict: "unverifiable", reason: `no call to ${c.writes.join(", ")} in the code — NOT treated as satisfied`, offenders: [] };
  if (unknown.length) return { verdict: "unverifiable", reason: `only ${who} may write ${what}: cannot tell where ${unknown.slice(0, 4).join("; ")} writes`, offenders: [] };
  return { verdict: "pass", reason: `only ${who} may write ${what}: ${ours ? `every write (${ours}) is theirs` : "no write to it in the code yet"} (a write through a function value passed around is not seen)`, offenders: [] };
}

const CONDITIONAL = new Set(["if_stmt", "for_loop", "while_loop", "for_stmt", "while_stmt", "except_handler", "comprehension"]);

export function checkAlwaysWith(facts: ArchCheckFacts, c: AlwaysWithCheck): Result {
  if (!facts.irFiles) return { verdict: "unverifiable", reason: "no IR was supplied to this check — NOT treated as satisfied", offenders: [] };
  const [owner, name] = c.target.includes(".") ? c.target.split(".") : [null, c.target];
  const offenders: string[] = [];
  let defs = 0;
  for (const [file, ir] of Object.entries(facts.irFiles)) {
    const nodes = (ir?.nodes ?? []) as any[];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const d of nodes) {
      if (d.type !== "function_def" || d.name !== name) continue;
      if (owner && !String(d.id).includes(`/${owner}.class/`)) continue;
      defs++;
      const body = nodes.filter((n) => String(n.id).startsWith(`${d.id}/`) && enclosingName(n.id) === enclosingName(`${d.id}/x`));
      const ys = body.filter((n) => calleeIs(String(n.callTarget ?? n.funcName ?? ""), [c.with]));
      const chain = (n: any) => { const out: any[] = []; for (let p = byId.get(n.parentId); p && p.id !== d.id; p = byId.get(p.parentId)) out.push(p); return out; };
      const plain = ys.filter((y) => !chain(y).some((p) => CONDITIONAL.has(p.type)));
      // Both arms of one unconditional if calling it count as every path.
      const ifs = new Map<string, { then: boolean; els: boolean; node: any }>();
      for (const y of ys) {
        const ch = chain(y);
        const top = [...ch].reverse().find((p: any) => CONDITIONAL.has(p.type));
        if (!top || top.type !== "if_stmt" || chain(top).some((p) => CONDITIONAL.has(p.type))) continue;
        const e = ifs.get(top.id) ?? { then: false, els: false, node: top };
        if (typeof top.elseLine === "number" && y.line >= top.elseLine) e.els = true; else e.then = true;
        ifs.set(top.id, e);
      }
      const bothArms = [...ifs.values()].filter((e) => e.then && e.els).map((e) => e.node);
      const first = [...plain, ...bothArms].sort((a, b) => a.line - b.line)[0];
      if (!first) {
        offenders.push(ys.length ? `${file}:${d.line} ${c.target} calls ${c.with} only inside a branch or loop (line ${ys.map((y) => y.line).join(", ")})` : `${file}:${d.line} ${c.target} never calls ${c.with}`);
        continue;
      }
      const early = body.filter((n) => n.type === "return_stmt" && n.line < first.line);
      if (early.length) offenders.push(`${file}:${early[0].line} ${c.target} can return before calling ${c.with} (line ${first.line})`);
    }
  }
  if (!defs) return { verdict: "unverifiable", reason: `no function ${c.target} is defined in the code — NOT treated as satisfied`, offenders: [] };
  return offenders.length
    ? { verdict: "violated", reason: `every path through ${c.target} must call ${c.with}: ${offenders.join("; ")}`, offenders }
    : { verdict: "pass", reason: `every path through ${c.target} (${defs} definition${defs === 1 ? "" : "s"}) calls ${c.with} (an exception thrown before it is not followed)`, offenders: [] };
}

export function checkIdScheme(facts: ArchCheckFacts, c: IdSchemeCheck): Result {
  if (!facts.irFiles) return { verdict: "unverifiable", reason: "no IR was supplied to this check — NOT treated as satisfied", offenders: [] };
  const defined = Object.values(facts.irFiles).some((ir: any) => (ir?.nodes ?? []).some((n: any) => n.type === "function_def" && c.producers.some((p) => p === n.name || p.endsWith(`.${n.name}`))));
  const writes = calls(facts, c.writes).filter(({ n }) => (n.args ?? []).map(String).map(literalOf).some((l: string | null) => l !== null && familyMatches(c.family, l)));
  if (!defined) return { verdict: "unverifiable", reason: `no producer ${c.producers.join(", ")} is defined — NOT treated as satisfied`, offenders: [] };
  if (!writes.length) return { verdict: "unverifiable", reason: `no write of family ${c.family} (a literal "${c.family}" argument to ${c.writes.join(", ")}) in the code — NOT treated as satisfied`, offenders: [] };
  const offenders: string[] = [];
  const unknown: string[] = [];
  const produced = (text: string) => c.producers.some((p) => new RegExp(`(^|[^\\w.])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`).test(text));
  const fam = new RegExp(`["'\`][^"'\`]*\\b${c.family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^"'\`]*["'\`]`);
  for (const { file, n } of writes) {
    const ir = facts.irFiles[file];
    const fnPrefix = String(n.id).split("/").slice(0, -1).join("/");
    const args: string[] = (n.args ?? []).map(String);
    const cands = c.idArg !== undefined ? [args[c.idArg] ?? ""] : args.filter((a) => literalOf(a) === null || !familyMatches(c.family, literalOf(a)!));
    // Names bound in the same function from a call: `const id = verdictId(r)`.
    const bound = new Map<string, string>();
    for (const a of (ir?.nodes ?? []) as any[]) {
      if (a.type !== "assignment" || !String(a.id).startsWith(fnPrefix)) continue;
      for (const t of [].concat(a.targets ?? a.target ?? a.name ?? [])) if (typeof t === "string") bound.set(t, String(a.callTarget ?? a.value ?? a.preview ?? ""));
    }
    const ok = cands.some((a) => produced(a) || (bound.has(a.trim()) && produced(`${bound.get(a.trim())}(`)));
    if (ok) continue;
    const inline = cands.find((a) => fam.test(a) && !produced(a));
    if (inline) { offenders.push(`${loc(file, n)} builds a ${c.family} id inline (${inline.slice(0, 60)})`); continue; }
    unknown.push(`${loc(file, n)} (id from ${cands.filter((a) => literalOf(a) === null).slice(0, 2).join(", ") || "a literal"})`);
  }
  if (offenders.length) return { verdict: "violated", reason: `${c.family} ids come only from ${c.producers.join(", ")}: ${offenders.slice(0, 5).join("; ")}`, offenders };
  if (unknown.length) return { verdict: "unverifiable", reason: `${c.family} ids come only from ${c.producers.join(", ")}: cannot tell who produced the id at ${unknown.slice(0, 4).join("; ")}`, offenders: [] };
  return { verdict: "pass", reason: `${c.family} ids come only from ${c.producers.join(", ")}: every write (${writes.length}) passes its result (an id that travels through another function first is not followed)`, offenders: [] };
}

export function describeAuthority(c: SingleWriterCheck | AlwaysWithCheck | IdSchemeCheck): string {
  if (c.rule === "single-writer") return `only ${[...(c.by ?? []), ...(c.files ?? [])].join(", ")} write ${c.zone ? `zone ${c.zone}` : ""}${c.zone && c.families?.length ? " / " : ""}${c.families?.length ? `family ${c.families.join(", ")}` : ""} (through ${c.writes.join(", ")})`;
  if (c.rule === "always-with") return `every path through \`${c.target}\` calls \`${c.with}\``;
  return `${c.family} ids come only from ${c.producers.join(", ")}`;
}
