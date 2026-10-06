// SCOPE THIS NODE (2026-10-06, part 3 of In → Process → Out): where the IR
// is silent about what a box does — an SDK the project only calls, a platform
// client — a model is shown the box's DOSSIER and may describe it, but only in
// the operation vocabulary's words, and every claim must cite a line it was
// shown. The architecture proposal's rules, per box:
//
//   * the dossier is numbered: code lines around every call site and the
//     head of each entry file (`file:line`), the edges that touch it (their
//     ids), a ratified software spec's definition and operations
//     (`spec:<tool>:…`); nothing else is citable;
//   * a word outside the vocabulary, or a box that does not exist, is
//     REFUSED and named; a citation not shown is dropped; the box's own id is
//     not evidence about itself (circular); a claim left with no citation is
//     kept as INFERRED and drawn faded;
//   * the result is PROPOSED in `.vibegraph/architecture.json` (`scopes`); only
//     a person ratifies it, and only a ratified scope reaches In → Process →
//     Out, architecture.md and the hooks.
//
// Pure apart from reading the lines it shows (readLines is passed in).

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { SoftwareSpec } from "../shared/software_types.ts";
import { nodeIO, ioLines, CORE_VOCABULARY, type Vocabulary, type ScopeBody, type NodeScopeRecord } from "../shared/node_io.ts";

export const SCOPE_LIMITS = { files: 6, linesPerSite: 7, headLines: 30, totalLines: 220, summary: 240, what: 100, rows: 8 };

export interface Dossier { text: string; cites: Set<string> }

/** Everything the model may see and cite about one box. */
export function scopeDossier(model: ArchModelRecord, nodeId: string, opts: {
  readLines: (file: string) => string[] | null; specs?: SoftwareSpec[]; vocab?: Vocabulary;
}): Dossier | null {
  const n = model.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  const vocab = opts.vocab ?? CORE_VOCABULARY;
  const cites = new Set<string>();
  const L: string[] = [];
  const label = (id: string) => model.nodes.find((x) => x.id === id)?.label ?? id;
  L.push(`BOX ${n.id} — "${n.label}" (${n.kind}, ${n.category}${n.role ? `, role ${n.role}` : ""}${n.tool ? `, tool ${n.tool}` : ""}): ${n.sublabel}`);
  for (const note of (n.notes ?? []).slice(0, 4)) L.push(`  note: ${note}`);
  const io = ioLines(nodeIO(model, nodeId, vocab, {}));
  L.push(`WHAT THE CODE ALREADY SHOWS (zero-token derivation): in: ${io.in} | process: ${io.process} | out: ${io.out}`, "");

  // the edges that touch it — citable by id
  const touching = model.edges.filter((e) => e.from === nodeId || e.to === nodeId).slice(0, 24);
  if (touching.length) L.push("EDGES (cite by id):");
  for (const e of touching) {
    cites.add(e.id);
    const pay = (e.payloads ?? []).filter((p) => p.side === "caller").slice(0, 2).map((p) => p.text).join(" ; ");
    L.push(`- ${e.id}: ${label(e.from)} → ${label(e.to)} · ${e.kind} ${e.protocol} — ${e.protocolBasis}${pay ? ` — the call: ${pay}` : ""}`);
  }

  // code: lines around each call site, and the head of each entry file
  const sites = new Map<string, Set<string>>(); // file → call texts
  for (const r of [...n.refs, ...touching.flatMap((e) => [...e.refs, ...(e.payloads ?? []).flatMap((p) => (p.where ? [{ ...p.where, text: p.text }] : []))])]) {
    if (!r.file) continue;
    const head = /([A-Za-z_$][\w$.]*)\s*\(/.exec(r.text ?? "")?.[1]?.split(".").pop();
    if (!sites.has(r.file)) sites.set(r.file, new Set());
    if (head) sites.get(r.file)!.add(head);
  }
  const entryFiles = [...new Set((n.entryPoints ?? []).map((ep) => ep.replace(/:[^:]*$/, "")))];
  let shown = 0;
  const show = (file: string, from: number, to: number, why: string) => {
    const lines = opts.readLines(file);
    if (!lines || shown >= SCOPE_LIMITS.totalLines) return;
    L.push(`CODE ${file} (${why}):`);
    for (let i = Math.max(0, from); i < Math.min(lines.length, to) && shown < SCOPE_LIMITS.totalLines; i++, shown++) {
      cites.add(`${file}:${i + 1}`);
      L.push(`${file}:${i + 1}: ${lines[i].slice(0, 200)}`);
    }
  };
  for (const [file, heads] of [...sites].slice(0, SCOPE_LIMITS.files)) {
    const lines = opts.readLines(file);
    if (!lines) continue;
    const hits = lines.map((l, i) => ([...heads].some((h) => l.includes(`${h}(`)) ? i : -1)).filter((i) => i >= 0).slice(0, 3);
    for (const i of hits.length ? hits : [0]) show(file, i - 3, i + 4, hits.length ? "around a call site" : "its head");
  }
  for (const f of entryFiles.slice(0, 3)) if (!sites.has(f)) show(f, 0, SCOPE_LIMITS.headLines, "an entry file's head");

  // a ratified software spec for its tool
  const spec = (opts.specs ?? []).find((s) => s.status === "ratified" && (s.tool === n.tool || s.identity.packages.some((p) => p === n.tool || p === n.label)));
  if (spec) {
    L.push(`SOFTWARE SPEC ${spec.tool} (ratified):`);
    cites.add(`spec:${spec.tool}:definition`);
    L.push(`- spec:${spec.tool}:definition: ${spec.definition}`);
    for (const o of spec.operations.slice(0, 20)) {
      cites.add(`spec:${spec.tool}:op:${o.name}`);
      L.push(`- spec:${spec.tool}:op:${o.name}: ${o.does}${o.on ? ` ${o.on}` : ""}${o.note ? ` — ${o.note}` : ""}`);
    }
  }
  L.push("", "OTHER BOXES (ids you may name in in / out):");
  for (const x of model.nodes.filter((x) => x.id !== nodeId).slice(0, 60)) L.push(`- ${x.id}: ${x.label}`);
  return { text: L.join("\n"), cites };
}

export function buildScopePrompt(model: ArchModelRecord, nodeId: string, dossier: Dossier, vocab: Vocabulary = CORE_VOCABULARY, guidance?: string): string {
  return [
    "You are scoping ONE box of a codebase's architecture map: say what it does, what data reaches it and where its data goes.",
    "Use ONLY these processing words (id — meaning):",
    ...vocab.words.map((w) => `- ${w.id} — ${w.definition}`),
    "",
    "Rules: every word and every in / out entry must cite what you were shown below — a `file:line`, an edge id, or a `spec:…` line. Do not cite the box's own id. Anything you cannot cite, leave out or give an empty evidence list (it will be shown as INFERRED). Name only boxes listed. Keys and values you did not see must not be invented.",
    ...(guidance ? ["", `The person asks: ${guidance}`] : []),
    "",
    dossier.text,
    "",
    "Reply with ONE JSON object and nothing else:",
    `{"summary":"<one sentence, ≤${SCOPE_LIMITS.summary} chars: what ${nodeId} does>","words":[{"word":"<a word id above>","evidence":["<citation>"]}],"in":[{"node":"<box id that sends it data>","what":"<≤${SCOPE_LIMITS.what} chars>","evidence":["<citation>"]}],"out":[{"node":"<box id that takes its data>","what":"<≤${SCOPE_LIMITS.what} chars>","evidence":["<citation>"]}]}`,
  ].join("\n");
}

function jsonOf(text: string): Record<string, unknown> | null {
  let body = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  if (fence) body = fence[1].trim();
  const a = body.indexOf("{"), b = body.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

/** The gate: what comes back is checked against what was shown. */
export function parseScope(text: string, model: ArchModelRecord, nodeId: string, dossier: Dossier, meta: { model: string; vocab?: Vocabulary; now?: () => Date }): { scope: ScopeBody | null; error?: string } {
  const obj = jsonOf(text);
  if (!obj) return { scope: null, error: "the reply contained no JSON object" };
  const vocab = meta.vocab ?? CORE_VOCABULARY;
  const refused: ScopeBody["refused"] = [];
  const ids = new Set(model.nodes.map((n) => n.id));
  const keep = (raw: unknown, item: string): string[] => {
    const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : [];
    const bad = list.filter((c) => !dossier.cites.has(c) && c !== nodeId);
    if (bad.length) refused.push({ item, reason: `citation(s) not among what was shown, dropped: ${bad.slice(0, 4).join(", ")}` });
    if (list.includes(nodeId)) refused.push({ item, reason: "the box's own id is not evidence about itself (circular), dropped" });
    return [...new Set(list.filter((c) => dossier.cites.has(c)))].slice(0, 6);
  };
  const words: ScopeBody["words"] = [];
  for (const raw of Array.isArray(obj.words) ? obj.words : []) {
    const w = (raw && typeof raw === "object" ? raw : { word: raw }) as Record<string, unknown>;
    const id = typeof w.word === "string" ? w.word.trim() : "";
    if (!vocab.words.some((x) => x.id === id)) { refused.push({ item: `word ${id || "?"}`, reason: "not a word of the vocabulary (operations.json)" }); continue; }
    if (words.some((x) => x.word === id)) continue;
    words.push({ word: id, evidence: keep(w.evidence, `word ${id}`) });
  }
  const rows = (raw: unknown, side: "in" | "out"): ScopeBody["in"] => {
    const out: ScopeBody["in"] = [];
    for (const r of (Array.isArray(raw) ? raw : []).slice(0, SCOPE_LIMITS.rows)) {
      const x = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const node = typeof x.node === "string" ? x.node.trim() : "";
      if (!ids.has(node) || node === nodeId) { refused.push({ item: `${side} ${node || "?"}`, reason: node === nodeId ? "a box does not send data to itself" : "names a box the model was not shown" }); continue; }
      const what = typeof x.what === "string" ? x.what.trim().slice(0, SCOPE_LIMITS.what) : "";
      out.push({ node, what, evidence: keep(x.evidence, `${side} ${node}`) });
    }
    return out;
  };
  const inn = rows(obj.in, "in"), out = rows(obj.out, "out");
  const summary = typeof obj.summary === "string" ? obj.summary.trim().slice(0, SCOPE_LIMITS.summary) : "";
  if (!words.length && !inn.length && !out.length) return { scope: null, error: `nothing usable came back${refused.length ? ` (${refused.map((r) => `${r.item}: ${r.reason}`).join("; ")})` : ""}` };
  return { scope: { at: (meta.now ?? (() => new Date()))().toISOString(), model: meta.model, summary, words, in: inn, out, refused } };
}

/** A person's decision on a proposed scope. */
export function decideScope(scopes: Record<string, NodeScopeRecord>, nodeId: string, decision: "ratify" | "reject", now: Date = new Date()): { scopes: Record<string, NodeScopeRecord>; error?: string } {
  const cur = scopes[nodeId];
  if (!cur?.proposed) return { scopes, error: `no scope of ${nodeId} is waiting for a decision` };
  const next = { ...scopes };
  if (decision === "ratify") next[nodeId] = { node: nodeId, ratified: { ...cur.proposed, ratifiedAt: now.toISOString() } };
  else if (cur.ratified) next[nodeId] = { node: nodeId, ratified: cur.ratified };
  else delete next[nodeId];
  return { scopes: next };
}

/** What `.vibegraph/architecture.json` may hold under `scopes` (arch_store reads it through this). */
export function validScopes(raw: unknown): Record<string, NodeScopeRecord> {
  const out: Record<string, NodeScopeRecord> = {};
  if (!raw || typeof raw !== "object") return out;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const body = (b: unknown): ScopeBody | undefined => {
    if (!b || typeof b !== "object") return undefined;
    const x = b as Record<string, unknown>;
    const rows = (v: unknown) => (Array.isArray(v) ? v : []).filter((r) => r && typeof r === "object" && typeof (r as any).node === "string")
      .map((r: any) => ({ node: r.node, what: typeof r.what === "string" ? r.what : "", evidence: strs(r.evidence) }));
    return {
      at: typeof x.at === "string" ? x.at : "", model: typeof x.model === "string" ? x.model : "unknown", summary: typeof x.summary === "string" ? x.summary : "",
      words: (Array.isArray(x.words) ? x.words : []).filter((w: any) => w && typeof w.word === "string").map((w: any) => ({ word: w.word, evidence: strs(w.evidence) })),
      in: rows(x.in), out: rows(x.out),
      refused: (Array.isArray(x.refused) ? x.refused : []).filter((r: any) => r && typeof r.item === "string").map((r: any) => ({ item: r.item, reason: String(r.reason ?? "") })),
      ...(typeof x.ratifiedAt === "string" ? { ratifiedAt: x.ratifiedAt } : {}),
    };
  };
  for (const [id, rec] of Object.entries(raw as Record<string, unknown>)) {
    const r = (rec && typeof rec === "object" ? rec : {}) as Record<string, unknown>;
    const ratified = body(r.ratified), proposed = body(r.proposed);
    if (ratified || proposed) out[id] = { node: id, ...(ratified ? { ratified } : {}), ...(proposed ? { proposed } : {}) };
  }
  return out;
}
