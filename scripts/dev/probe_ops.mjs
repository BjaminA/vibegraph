// dev probe: every derived data operation, grouped by the entry that reaches it.
//   node --experimental-strip-types scripts/dev/probe_ops.mjs <root> [entry-substring…]
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "../cli/pipeline.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { deriveDataArchitecture } from "../../src/server/data_arch.ts";
import { registeredAccess } from "../../src/server/registered_access.ts";

const [root, ...want] = process.argv.slice(2);
const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
const da = deriveDataArchitecture(envelope.files, buildStackIndex(envelope, root), envelope.threads, registeredAccess(root));
const by = new Map();
for (const o of da.operations ?? da.ops ?? []) for (const e of o.entries.length ? o.entries : ["(no entry)"]) {
  if (want.length && !want.some((w) => e.includes(w))) continue;
  if (!by.has(e)) by.set(e, new Set());
  by.get(e).add(`${o.op} ${o.family}`);
}
for (const [e, s] of [...by].sort()) console.log(`${e}: ${[...s].sort().join(", ")}`);
console.log("keys:", Object.keys(da).join(", "));
