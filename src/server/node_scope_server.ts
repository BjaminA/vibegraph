// "Scope this node" on the live server (2026-10-06): the one token-spending
// step of In → Process → Out, and the person's decision on it. The state it
// needs (the project root, the map, the model runner) is passed in, so
// server.ts only routes the WS messages here.

import * as fs from "fs";
import * as path from "path";
import type { ArchModelRecord } from "../shared/protocol.ts";
import { loadArchStore, saveArchStore } from "./arch_store.ts";
import { listSpecs } from "./software_store.ts";
import { loadVocabulary } from "./operation_vocab.ts";
import { buildScopePrompt, decideScope, parseScope, scopeDossier } from "./node_scope.ts";

export interface ScopeCtx {
  root: () => string | null;
  model: () => ArchModelRecord | null;
  claudeAvailable: () => boolean;
  /** runs one model call; null = nothing came back */
  run: (prompt: string) => Promise<string | null>;
  modelLabel: () => string;
  /** after the store changed: re-broadcast and refresh the exported docs */
  changed: () => void;
}

export function linesReader(root: string): (file: string) => string[] | null {
  const cache = new Map<string, string[] | null>();
  return (file) => {
    if (cache.has(file)) return cache.get(file)!;
    const abs = path.resolve(root, file);
    let lines: string[] | null = null;
    if (abs.startsWith(path.resolve(root) + path.sep)) { try { lines = fs.readFileSync(abs, "utf-8").split(/\r?\n/); } catch { lines = null; } }
    cache.set(file, lines);
    return lines;
  };
}

export async function scopeNode(ctx: ScopeCtx, nodeId: string, guidance?: string): Promise<{ ok: boolean; error?: string; words?: number; refused?: number }> {
  const root = ctx.root(), model = ctx.model();
  if (!root) return { ok: false, error: "scoping needs a project directory" };
  if (!model?.nodes.some((n) => n.id === nodeId)) return { ok: false, error: `no box ${nodeId} on the map` };
  if (!ctx.claudeAvailable()) return { ok: false, error: "the claude CLI is unavailable — can't scope a box" };
  const vocab = loadVocabulary(root).vocab;
  let specs: ReturnType<typeof listSpecs> = [];
  try { specs = listSpecs(root); } catch { specs = []; }
  const dossier = scopeDossier(model, nodeId, { readLines: linesReader(root), specs, vocab })!;
  const g = typeof guidance === "string" ? guidance.trim().slice(0, 400) : "";
  const text = await ctx.run(buildScopePrompt(model, nodeId, dossier, vocab, g || undefined));
  if (text === null) return { ok: false, error: "the model returned nothing" };
  const parsed = parseScope(text, model, nodeId, dossier, { model: ctx.modelLabel(), vocab });
  if (!parsed.scope) return { ok: false, error: parsed.error };
  const store = loadArchStore(root);
  const cur = store.scopes?.[nodeId];
  store.scopes = { ...(store.scopes ?? {}), [nodeId]: { node: nodeId, ...(cur?.ratified ? { ratified: cur.ratified } : {}), proposed: parsed.scope } };
  saveArchStore(root, store);
  ctx.changed();
  return { ok: true, words: parsed.scope.words.length, refused: parsed.scope.refused.length };
}

export function decideNodeScope(ctx: ScopeCtx, nodeId: string, decision: "ratify" | "reject"): { ok: boolean; error?: string } {
  const root = ctx.root();
  if (!root) return { ok: false, error: "scoping needs a project directory" };
  const store = loadArchStore(root);
  const r = decideScope(store.scopes ?? {}, nodeId, decision);
  if (r.error) return { ok: false, error: r.error };
  store.scopes = r.scopes;
  if (!Object.keys(store.scopes).length) delete store.scopes;
  saveArchStore(root, store);
  ctx.changed();
  return { ok: true };
}
