// The ARCHITECTURE slice for the prompt hook (2026-09-29): what a person
// stated in `.vibegraph/architecture.json` — which host / trust zone /
// network a thread's process runs in, and the primary path — attached to the
// threads a prompt routes to. It is the one kind of fact the code cannot
// reveal and the knowledge folder only offered as a file Claude had to open.
//
// STATED only: a pending model proposal is never sent (it is not decided).
// Frequency, so it never becomes noise:
//   - a thread's placement line is sent once per session;
//   - a group's note is sent once per session, and never when a stated rule
//     already says it (the rules arrive beside it; no fact twice);
//   - the primary path is spelled out once, then referred to by step.
// Zero tokens; the derived model is built only when the file states something.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDirFor } from "../envelope_cache.mjs";
import { loadArchStore } from "../../src/server/arch_store.ts";
import { archModelForEnvelope } from "../../src/server/arch_envelope.ts";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildCrossingIndex } from "../../src/server/crossings.ts";

/** The stated half, or null when there is nothing a person decided. */
export function statedArchitecture(absRoot) {
  const s = loadArchStore(absRoot);
  return s.groups.length || s.primaryPath?.length ? s : null;
}

/** entry point → the derived processes / dispatchers its thread belongs to
 *  ({id, label}). Building the derived model costs seconds on a large
 *  project (4.3 s on a private production codebase), so the placement is cached beside the
 *  envelope, keyed on every thread's entry point and files: it changes only
 *  when the threads do. */
export function archPlacement(env, absRoot) {
  const key = createHash("sha1").update(JSON.stringify(env.threads.map((t) => [t.entryPointId, t.filesReached ?? []]))).digest("hex");
  const file = join(cacheDirFor(absRoot), "arch-placement.json");
  try {
    const c = JSON.parse(readFileSync(file, "utf-8"));
    if (c.key === key) return new Map(Object.entries(c.byEp));
  } catch { /* no cache yet, or unreadable: build */ }
  const model = archModelForEnvelope(env, buildStackIndex(env, absRoot), buildCrossingIndex(env), absRoot, undefined, { applyStore: false });
  const byEp = new Map();
  for (const n of model.nodes) {
    if (n.kind !== "cluster" && n.kind !== "hub") continue;
    for (const ep of n.threads ?? []) (byEp.get(ep) ?? byEp.set(ep, []).get(ep)).push({ id: n.id, label: n.label });
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ key, byEp: Object.fromEntries(byEp) }));
  } catch { /* a cache that cannot be written is only slower */ }
  return byEp;
}

/** For one prompt: `(ep) => lines | null`. The derived placement is built
 *  (or read from its cache) only when the file states something and a routed
 *  thread has not had its line yet. */
export function archForPrompt(absRoot, env, routedEps, state, constraints) {
  const store = statedArchitecture(absRoot);
  const sent = new Set(state.arch?.threads ?? []);
  const placement = store && routedEps.some((ep) => !sent.has(ep)) ? archPlacement(env, absRoot) : null;
  const ruleTexts = constraints.map((k) => k.text ?? "");
  return (ep) => (placement ? archLinesFor(ep, { store, placement, state, ruleTexts }) : null);
}

/** Outermost first: the stated groups that hold a node, through `parent`. */
function chainOf(store, nodeId) {
  const byId = new Map(store.groups.map((g) => [g.id, g]));
  const direct = store.groups.find((g) => g.wraps.includes(nodeId));
  const chain = [];
  for (let g = direct; g && !chain.includes(g); g = g.parent ? byId.get(g.parent) : undefined) chain.unshift(g);
  return chain;
}

const said = (text, ruleTexts) => ruleTexts.some((t) => t.toLowerCase().includes(text.toLowerCase().slice(0, 60)));

/** The lines for one routed thread, or null (nothing stated about it, or
 *  already sent). Mutates `state.arch` to remember what was sent. */
export function archLinesFor(ep, { store, placement, state, ruleTexts }) {
  const sent = (state.arch ??= { threads: [], groups: [], path: false });
  sent.places ??= [];
  if (sent.threads.includes(ep)) return null;
  const lines = [];
  for (const node of placement.get(ep) ?? []) {
    const chain = chainOf(store, node.id);
    if (!chain.length) continue;
    // A place already spelled out this session is named by its innermost group.
    if (sent.places.includes(node.id)) {
      const inner = chain[chain.length - 1];
      lines.push(`Runs in (stated): ${inner.kind} "${inner.label}" (placement given above).`);
      continue;
    }
    sent.places.push(node.id);
    const name = store.names?.[node.id] ?? node.label;
    lines.push(`Runs in (stated): ${chain.map((g) => `${g.kind} "${g.label}"`).join(" › ")} — process "${name}".`);
    for (const g of chain) {
      // A ratified group's note is its provenance ("ratified from <model> …
      // evidence: …"), not a fact about the code — not worth its tokens.
      if (!g.note || /^ratified from /.test(g.note) || sent.groups.includes(g.id)) continue;
      sent.groups.push(g.id);
      if (!said(g.note, ruleTexts)) lines.push(`  ${g.kind} "${g.label}": ${g.note}`);
    }
  }
  const path = store.primaryPath ?? [];
  const at = path.indexOf(ep);
  if (at >= 0) {
    if (!sent.path) {
      lines.push(`On the stated primary path (step ${at + 1} of ${path.length}): ${path.join(" → ")}.`);
      sent.path = true;
    } else lines.push(`Step ${at + 1} of ${path.length} on the stated primary path (given earlier).`);
  }
  if (!lines.length) return null;
  sent.threads.push(ep);
  return `## Where it runs (from .vibegraph/architecture.json, stated by a person)\n${lines.join("\n")}`;
}
