// Which version wrote .vibegraph/ (2026-10-07, field report: an older local
// install served a plan.json a newer one wrote, and the Plan panel silently
// did nothing), and two installs that disagree.
//
//   npm run test:writer-stamp
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newerVersion, stampWriter, writerWarning, WRITER_FILE } from "../src/server/writer_stamp.ts";
import { installMismatch } from "../scripts/cli/host_check.mjs";
import { saveConstraints } from "../src/server/constraint_store.ts";

const tmp = mkdtempSync(join(tmpdir(), "vg-writer-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("versions compare by number, not by text", () => {
  assert.equal(newerVersion("0.27.10", "0.27.9"), true);
  assert.equal(newerVersion("0.27.4", "0.27.4"), false);
  assert.equal(newerVersion("0.27.1", "0.27.4"), false);
  assert.equal(newerVersion("1.0.0", "0.99.99"), true);
});

test("a store write stamps the newest version; an older reader is warned", () => {
  const root = join(tmp, "p");
  mkdirSync(root);
  saveConstraints(root, []);
  assert.throws(() => readFileSync(join(root, WRITER_FILE)), "no version known (a dev run): nothing stamped");
  stampWriter(root, "plan.json", "0.27.4");
  stampWriter(root, "plan.json", "0.27.1");
  assert.deepEqual(JSON.parse(readFileSync(join(root, WRITER_FILE), "utf-8")), { version: "0.27.4" }, "an older writer never lowers the stamp");
  assert.match(writerWarning(root, "0.27.1"), /written by vibegraph-knowledge 0\.27\.4; this is 0\.27\.1/);
  assert.equal(writerWarning(root, "0.27.4"), null);
  assert.equal(writerWarning(root, "0.28.0"), null);
  assert.equal(writerWarning(root, undefined), null);
});

test("two installs that disagree are named, with which one is running", () => {
  const root = join(tmp, "q"), g = join(tmp, "global");
  for (const [dir, v] of [[join(root, "node_modules"), "0.27.1"], [g, "0.27.4"]]) {
    mkdirSync(join(dir, "vibegraph-knowledge"), { recursive: true });
    writeFileSync(join(dir, "vibegraph-knowledge", "package.json"), JSON.stringify({ version: v }));
  }
  const local = installMismatch(root, "0.27.1", join(root, "node_modules", "vibegraph-knowledge", "dist", "cli.mjs"), () => g);
  assert.match(local, /node_modules has 0\.27\.1, the global one is 0\.27\.4; this is the LOCAL 0\.27\.1/);
  assert.match(local, /npx vibegraph-knowledge@latest/);
  assert.match(installMismatch(root, "0.27.4", "/usr/lib/node_modules/vibegraph-knowledge/dist/cli.mjs", () => g), /this is the global 0\.27\.4/);
  assert.equal(installMismatch(root, "0.27.1", "", () => null), null, "no global install: nothing to compare");
});
