// Which parsed files an architecture model was derived from (2026-10-08). The
// Brief hashes a stated rule together with the code its check names (an edit
// to the function a callers-only rule guards stales the line resting on it), and
// that needs the IR. Every model is built by archModelForEnvelope and
// re-stated by applyArchStore, so both record the files here and every reader
// of a model — CLI, server, inbox, export — hashes the same basis without a
// new parameter on each. A WeakMap: nothing is kept alive by it.

type Files = Record<string, { nodes?: any[] }>;
const SOURCE = new WeakMap<object, Files>();

export function recordModelSource<T extends object>(model: T, files: Files | null | undefined): T {
  if (files) SOURCE.set(model, files);
  return model;
}

/** Carry a model's files over to one derived from it (a store applied). */
export function carryModelSource<T extends object>(from: object, to: T): T {
  const f = SOURCE.get(from);
  if (f) SOURCE.set(to, f);
  return to;
}

export function modelSource(model: object): Files | null {
  return SOURCE.get(model) ?? null;
}
