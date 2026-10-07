// Plans the documents an import writes.

export interface ImportWrite { path: string; value: unknown; role: string }

/** Every document one example file becomes. */
export async function planImport(text: string): Promise<ImportWrite[]> {
  return text.split("\n").filter(Boolean).map((line, i) => ({ path: `/items/${i}`, value: line, role: "loader" }));
}
