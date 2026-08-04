#!/usr/bin/env node
// Validate a VibeGraph IR file against schemas/ir.schema.json and the
// structural-path node-ID grammar. Zero-judgment check — runnable, not
// eyeballed. Owned by the vibegraph-ir skill (bump that skill's version
// if this script's behaviour changes, so doc and tool stay in lockstep).
//
// Handles the three on-disk shapes:
//   • bare single-file IR        {version, nodes, edges, symbolIndex}
//                                  e.g. sample_advanced.ir.json
//   • linked file-map            {"app.py": IR, "db.py": IR, …}
//                                  e.g. flask_demo.ir.json  (validated
//                                  per-member against ir.schema.json,
//                                  mirroring test/parser.test.mjs)
//   • project envelope           pass --schema schemas/project_ir.schema.json
//                                  e.g. flask_demo.project.json
//
// Usage:
//   node scripts/validate_ir.mjs <ir.json> [--schema <path>]
//   node scripts/validate_ir.mjs test/fixtures/sample_advanced.ir.json
//   node scripts/validate_ir.mjs test/fixtures/threads/flask_demo/flask_demo.ir.json
//   node scripts/validate_ir.mjs \
//     test/fixtures/threads/aero_demo/aero_demo.project.json \
//     --schema schemas/project_ir.schema.json
//
// Exit 0 = valid; 1 = schema or ID-grammar violation; 2 = bad invocation.
// Mirrors the Ajv2020 setup in test/parser.test.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE_ID = /^module(\/[^/]+)*$/; // schemas/ir.schema.json $defs/NodeId

const args = process.argv.slice(2);
const irArg = args.find((a) => !a.startsWith("--"));
const schemaFlagIdx = args.indexOf("--schema");
const schemaOverridden = schemaFlagIdx !== -1;
const schemaPath = schemaOverridden
  ? resolve(args[schemaFlagIdx + 1])
  : join(ROOT, "schemas", "ir.schema.json");

if (!irArg) {
  console.error("usage: node scripts/validate_ir.mjs <ir.json> [--schema <path>]");
  process.exit(2);
}

const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
const data = JSON.parse(readFileSync(resolve(irArg), "utf-8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const problems = [];

// Validate one document + run a direct ID-grammar pass over its `nodes`.
// ajv reports $ref pattern failures cryptically (it points at the pattern,
// not the value), so re-check each id and name the offender. Returns the
// node count. NOTE: duplicate ids are NOT flagged — the parser legitimately
// emits sibling nodes sharing one structural id (e.g. an assignment in both
// arms of one `if`); disambiguation is by source line, never id uniqueness.
function checkDoc(doc, label) {
  if (!validate(doc)) {
    for (const e of validate.errors) {
      problems.push(`${label}schema: ${e.instancePath || "(root)"} ${e.message}`);
    }
  }
  const nodes = Array.isArray(doc?.nodes) ? doc.nodes : [];
  nodes.forEach((n, i) => {
    if (typeof n?.id !== "string" || !NODE_ID.test(n.id)) {
      problems.push(
        `${label}id-grammar: nodes[${i}].id = ${JSON.stringify(n?.id)} violates ^module(/…)*$`,
      );
    }
  });
  return nodes.length;
}

let summary;
if (schemaOverridden || Array.isArray(data.nodes)) {
  // Single document: a bare IR (default schema) or an envelope (--schema).
  const n = checkDoc(data, "");
  summary = Array.isArray(data.nodes)
    ? `${n} nodes, ${(data.edges || []).length} edges, version ${data.version}`
    : `version ${data.version}`;
} else {
  // Linked file-map { filename: IR } — validate each member.
  const entries = Object.entries(data);
  let total = 0;
  for (const [fname, ir] of entries) total += checkDoc(ir, `[${fname}] `);
  summary = `${entries.length} files, ${total} nodes total`;
}

if (problems.length) {
  console.error(`✗ ${irArg} — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ ${irArg} — valid (${summary})`);
