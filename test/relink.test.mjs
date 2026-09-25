/**
 * mergeRelinked / ParseGenerations — the rule that a re-link across an
 * await must not revert entries patched while the linker ran. Found by
 * the stack pre-check e2e: a rejected packet's restore scheduled a
 * refresh whose linker started on the clean map, the next packet's worker
 * added `import requests` while it ran, and the refresh's output hid the
 * import from the IR delta (text diff said models.py changed; the delta
 * said nothing; pre-checks approved).
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/relink.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeRelinked, ParseGenerations } from "../src/server/relink.ts";

const ir = (tag) => ({ nodes: [{ id: `module/${tag}.fn` }], tag });

test("unchanged files take the linked entry", () => {
  const current = { "/p/a.py": ir("a-solo"), "/p/b.py": ir("b-solo") };
  const linked = { "/p/a.py": ir("a-linked"), "/p/b.py": ir("b-linked") };
  const out = mergeRelinked(current, linked, () => false);
  assert.equal(out["/p/a.py"].tag, "a-linked");
  assert.equal(out["/p/b.py"].tag, "b-linked");
});

test("a file patched while the linker ran keeps its newer in-memory entry", () => {
  const gens = new ParseGenerations();
  const snap = gens.snapshot();
  const current = { "/p/a.py": ir("a-solo"), "/p/models.py": ir("with-import") };
  const linked = { "/p/a.py": ir("a-linked"), "/p/models.py": ir("clean-linked") };
  gens.touch("/p/models.py"); // the worker's edit landed mid-link
  const out = mergeRelinked(current, linked, gens.changedSince(snap));
  assert.equal(out["/p/models.py"].tag, "with-import", "the linker's stale output must not revert the edit");
  assert.equal(out["/p/a.py"].tag, "a-linked", "untouched files still take the linked entry");
});

test("a file deleted while the linker ran does not come back", () => {
  const gens = new ParseGenerations();
  const snap = gens.snapshot();
  const current = { "/p/a.py": ir("a") };
  const linked = { "/p/a.py": ir("a-linked"), "/p/gone.py": ir("gone-linked") };
  gens.touch("/p/gone.py");
  const out = mergeRelinked(current, linked, gens.changedSince(snap));
  assert.deepEqual(Object.keys(out), ["/p/a.py"]);
});

test("a file created while the linker ran is kept from the current map", () => {
  const current = { "/p/a.py": ir("a"), "/p/new.py": ir("new-solo") };
  const linked = { "/p/a.py": ir("a-linked") };
  const out = mergeRelinked(current, linked, (f) => f === "/p/new.py");
  assert.equal(out["/p/new.py"].tag, "new-solo");
  assert.equal(out["/p/a.py"].tag, "a-linked");
});

test("generations: a touch after the snapshot counts, a touch before does not", () => {
  const gens = new ParseGenerations();
  gens.touch("/p/a.py");
  const snap = gens.snapshot();
  const changed = gens.changedSince(snap);
  assert.equal(changed("/p/a.py"), false, "patched BEFORE the link started: the linker saw it");
  gens.touch("/p/a.py");
  assert.equal(changed("/p/a.py"), true, "patched AFTER: the linker did not");
  assert.equal(changed("/p/never.py"), false);
});

test("server.ts never assigns into the live map across an await", () => {
  // `projectParse[k] = await f()` evaluates `projectParse` BEFORE the await:
  // a re-link or full pass that replaces the map meanwhile leaves the
  // entry in an orphaned object. A rejected packet's restore did exactly
  // that, so the live map kept the rejected import and the next packet's
  // delta was empty (the stack pre-check e2e, ~1 in 8 under Playwright).
  const src = readFileSync(new URL("../server.ts", import.meta.url), "utf-8");
  const offenders = src.split("\n")
    .map((line, i) => [i + 1, line.trim()])
    .filter(([, line]) => /\bprojectParse\[[^\]]*\]\s*=\s*await\b/.test(line));
  assert.deepEqual(offenders, [], "parse first, assign after");
});
