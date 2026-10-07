// The shape from Ben's screenshot (2026-10-07): a test whose loop over example
// files holds a second loop over an awaited plan, with a store call inside —
// two nested for-of containers whose long headers both wrap.
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { planImport } from "./plan";

const EXAMPLES = new URL("./examples/", import.meta.url);

class MemorySource {
  docs = new Map<string, unknown>();
}

test("every example imports", async () => {
  const src = new MemorySource();
  const roles = new Set<string>();
  for (const f of readdirSync(EXAMPLES).filter((f) => f.endsWith(".xml")).sort()) {
    for (const w of await planImport(readFileSync(new URL(f, EXAMPLES), "utf8"))) { src.docs.set(w.path, w.value); roles.add(w.role); }
  }
});
