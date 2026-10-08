// Which parsed code an architecture model was derived from (2026-10-08). The
// Brief reads the code behind a model: the source of the functions a stated
// rule's check guards (an edit to one stales the lines resting on that rule),
// the grant and admin calls that apply a rule, and which files each thread
// reaches. Every model is built by archModelForEnvelope and re-stated by
// applyArchStore, so both record the source here, and every reader of a model
// (CLI, server, inbox, export) reads the same facts without a new parameter on
// each. A WeakMap: nothing is kept alive by it.
//
// A copy made with a spread (`{ ...model, drift }`) is a new object and has no
// source unless it is carried (carryModelSource). The Brief treats a missing
// source as "not known", never as "changed" (brief_store.ts), because the first
// version of this hashed "no code" against "the code" and marked every line
// resting on a rule STALE.

export interface ModelSource {
  files: Record<string, { nodes?: any[] }>;
  stack?: unknown;
  threads?: Array<{ entryPointId?: string | null; filesReached?: string[] }>;
}
const SOURCE = new WeakMap<object, ModelSource>();

export function recordModelSource<T extends object>(model: T, src: ModelSource | null | undefined): T {
  if (src?.files) SOURCE.set(model, src);
  return model;
}

/** Carry a model's source over to one derived from it (a store applied, drift added). */
export function carryModelSource<T extends object>(from: object, to: T): T {
  const s = SOURCE.get(from);
  if (s) SOURCE.set(to, s);
  return to;
}

export function modelSource(model: object): ModelSource | null {
  return SOURCE.get(model) ?? null;
}
