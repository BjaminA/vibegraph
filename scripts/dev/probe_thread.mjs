// dev probe: what a thread reaches, and the injections touching a name.
//   node --experimental-strip-types scripts/dev/probe_thread.mjs <root> <entry-substring> [name]
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "../cli/pipeline.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { deriveDataArchitecture } from "../../src/server/data_arch.ts";

const [root, want, name] = process.argv.slice(2);
const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
for (const t of envelope.threads.filter((x) => x.entryPointId.includes(want))) {
  const steps = (t.nodes ?? []).filter((n) => n.kind === "step").map((n) => `${n.file}:${n.label ?? n.irNodeId}`);
  console.log(`${t.entryPointId}: ${t.nodes?.length} nodes; steps: ${steps.slice(0, 40).join(", ")}`);
}
if (name) {
  const da = deriveDataArchitecture(envelope.files, buildStackIndex(envelope, root), envelope.threads);
  const inj = { injections: da.injections ?? [], unresolved: da.computed ?? [] };
  for (const j of inj.injections.filter((x) => JSON.stringify(x).includes(name))) console.log("injection:", JSON.stringify(j).slice(0, 600));
  console.log("unresolved:", inj.unresolved.filter((u) => u.includes(name)).slice(0, 5));
}
