// The operation vocabulary a project reads its boxes in (2026-10-06):
// VibeGraph's own words (src/shared/operations.json) plus the words a project
// ADDS in `.vibegraph/operations.json` — never a redefinition. A malformed or
// redefining word is refused with its reason and the rest still load.

import * as fs from "fs";
import * as path from "path";
import { CORE_VOCABULARY, mergeVocabulary, type Vocabulary } from "../shared/node_io.ts";
import { loadArchStore } from "./arch_store.ts";
import { linesReader, withScopeStaleness } from "./node_scope.ts";
import { listSpecs } from "./software_store.ts";

/** The store's scopes, each judged against the box's code NOW (stale or not). */
export function scopesNow(root: string, model: Parameters<typeof withScopeStaleness>[1]) {
  let specs: ReturnType<typeof listSpecs> = [];
  try { specs = listSpecs(root); } catch { specs = []; }
  return withScopeStaleness(loadArchStore(root).scopes, model, { readLines: linesReader(root), specs });
}

export const OPERATIONS_FILE = path.join(".vibegraph", "operations.json");

export function loadVocabulary(root: string | null): { vocab: Vocabulary; errors: string[] } {
  if (!root) return { vocab: CORE_VOCABULARY, errors: [] };
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(root, OPERATIONS_FILE), "utf-8")); } catch (e: any) {
    return e?.code === "ENOENT" ? { vocab: CORE_VOCABULARY, errors: [] } : { vocab: CORE_VOCABULARY, errors: [`${OPERATIONS_FILE}: ${e?.message ?? e}`] };
  }
  return mergeVocabulary(raw);
}

/** The model as the envelope carries it: with the project's own words, when
 *  it has any (the GUI already has VibeGraph's), and the scoped boxes
 *  (node_scope.ts). Never written to an export. */
export function withProjectWords<M extends Parameters<typeof withScopeStaleness>[1]>(model: M, root: string | null): M {
  const extra = loadVocabulary(root).vocab.words.filter((w) => w.project);
  const scopes = root ? scopesNow(root, model) : undefined;
  return extra.length || scopes ? { ...model, ...(extra.length ? { vocabulary: extra } : {}), ...(scopes ? { scopes } : {}) } : model;
}
