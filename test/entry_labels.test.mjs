// Repeated entry-point labels get the shortest distinguishing piece of their
// path (a private production codebase: twelve CLIs labelled `main`, two `naming.ts` scripts).
//
//   npm run test:entry-labels
import { test } from "node:test";
import assert from "node:assert/strict";
import { entryLabelSuffixes } from "../src/shared/entry_labels.ts";

test("a unique label gets no suffix; repeats get the file name when that differs", () => {
  const s = entryLabelSuffixes([
    { id: "a", label: "main", file: "ingest/pipeline/compare.py" },
    { id: "b", label: "main", file: "ingest/pipeline/build_zip_index.py" },
    { id: "c", label: "ingest", file: "x/ingest.py" },
  ]);
  assert.deepEqual([...s], [["a", "compare.py"], ["b", "build_zip_index.py"]]);
});

test("when the label IS the file name, the directories tell them apart, as few as needed", () => {
  const s = entryLabelSuffixes([
    { id: "a", label: "naming.ts", file: "web-app/lib/credits/server/naming.ts" },
    { id: "b", label: "naming.ts", file: "web-app/lib/userDb/naming.ts" },
  ]);
  assert.deepEqual([...s], [["a", "server"], ["b", "userDb"]]);
});

test("same file name in different directories takes a longer tail", () => {
  const s = entryLabelSuffixes([
    { id: "a", label: "main", file: "one/cli.py" },
    { id: "b", label: "main", file: "two/cli.py" },
  ]);
  assert.deepEqual([...s], [["a", "one/cli.py"], ["b", "two/cli.py"]]);
});

test("same label and same file: the node id is all that is left", () => {
  const s = entryLabelSuffixes([
    { id: "a", label: "run", file: "x.py", irNodeId: "module/run.fn" },
    { id: "b", label: "run", file: "x.py", irNodeId: "module/K.class/run.fn" },
  ]);
  assert.equal(s.get("a"), "x.py module/run.fn");
  assert.equal(s.get("b"), "x.py module/K.class/run.fn");
});
