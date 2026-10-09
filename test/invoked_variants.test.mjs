// INVOKED-NAME VARIANTS (2026-10-09, from a field brief that knew a launcher
// and not the free / paid split behind it): one script installed under several
// names, its `case "${0##*/}"` choosing what each name may do. A caller names
// the VARIANT, never the file, so a path match finds nothing. On
// test/fixtures/flow/variant_demo, through the real pipeline:
//
//   - the bash IR keeps each case arm's pattern (`casePatterns`)
//   - a composite TS return keeps its string literals
//   - a literal naming a variant is a command hop to the script, saying which
//     (`invokedAs`); the map edge carries it, and so does the Brief's edge line
//   - a bare word no script declares is not a hop
//
//   npm run test:invoked-variants
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { buildStackIndex } from "../src/server/stack.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { invokedNameVariants, variantRefs } from "../scripts/frontends/script_refs.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIX = join(ROOT, "test/fixtures/flow/variant_demo");
const env = buildPolyglotEnvelope(FIX).envelope;

test("the IR keeps a case's patterns and a composite return's literals", () => {
  const c = env.files["bin/tool"].nodes.find((n) => n.type === "if_stmt" && /^case/.test(n.condition));
  assert.deepEqual(c.casePatterns.map((p) => p.text), ["tool-public", "tool-metered", "*"]);
  const r = env.files["app/command.ts"].nodes.find((n) => n.type === "return_stmt");
  assert.ok(r.literals.includes("tool-metered") && r.literals.includes("tool-public"), JSON.stringify(r.literals));
});

test("a script answers to the plain-word names its case on $0 lists; a glob is no name", () => {
  const v = invokedNameVariants(env.files);
  assert.deepEqual([...v.keys()].sort(), ["tool-metered", "tool-public"]);
  assert.deepEqual(variantRefs({ type: "call", args: ['"/opt/app/bin/tool-metered"', '"report"'] }, v).map((x) => x.name), ["tool-metered"], "a path's last segment is the name");
  assert.deepEqual(variantRefs({ type: "call", args: ['"tool"', '"metered"'] }, v), [], "a word no script declares is not a hop");
});

test("the launcher's literals are command hops to the script, each saying which variant", () => {
  const hops = buildCrossingIndex(env).all.filter((c) => c.invokedAs).map((c) => `${c.file} → ${c.targets.map((t) => t.route).join(",")} as ${c.invokedAs} (${c.confidence})`).sort();
  assert.deepEqual(hops, ["app/command.ts → bin/tool as tool-metered (path)", "app/command.ts → bin/tool as tool-public (path)"]);
});

test("the map edge carries the variants, so the Brief's edge line says them", () => {
  const model = archModelForEnvelope(env, buildStackIndex(env, FIX), buildCrossingIndex(env), FIX);
  const e = model.edges.find((x) => x.kind === "command" && (x.details ?? []).some((d) => d.startsWith("as ")));
  assert.ok(e, JSON.stringify(model.edges.map((x) => [x.id, x.details])));
  assert.deepEqual(e.details.filter((d) => d.startsWith("as ")), ["as tool-metered", "as tool-public"]);
});
