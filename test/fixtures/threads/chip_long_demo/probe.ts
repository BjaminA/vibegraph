// The shape from Ben's screenshot (2026-10-02): a try around a for-of over a
// long array literal (with "→" in it), a catch, and a finally with its own
// loop — nested containers on neighbouring rows, one with a very long header.
import { deleteDoc, writeDoc } from "./store";

/** Write every probe row, then clean up whatever was created. */
export async function probe(owner: string): Promise<string[][]> {
  const rows: string[][] = [];
  const created: string[] = [];
  try {
    for (const [label, sid, doc] of [["P write extra glob_* → glob_a-1", "P", "glob_a-1"], ["P write extra rx_.* → rx_a-1", "P", "rx_a-1"], ["Q write plain → q_b-2", "Q", "q_b-2"], ["R write nested → r_c-3", "R", "r_c-3"]]) {
      try {
        await writeDoc(owner, sid, doc);
        created.push(doc);
      } catch (e) {
        rows.push([label, String(e)]);
      }
    }
  } finally {
    for (const id of created) {
      console.warn("cleanup", id);
      deleteDoc(owner, id).catch(() => undefined);
    }
  }
  return rows;
}

await probe(process.argv[2] ?? "me");
