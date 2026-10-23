// `services [<root>] [--json]` (2026-10-22, the root-cause handoff RC3): every
// external service the code or its deploy files give evidence for, with the
// evidence (src/server/service_inventory.ts). Zero tokens.
import { basename, resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";
import { cliPath } from "./winpath.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildServiceInventory } from "../../src/server/service_inventory.ts";
import { servicesPage } from "../../src/shared/services.ts";

export const SERVICES_USAGE = `services [<root>] [--json]     every external service, each with its evidence: a program the code runs, a host
                                  a request names, a credential it reads, a deploy file or workflow (zero tokens)`;

export function runServices(args) {
  const json = args.includes("--json");
  const root = resolve(cliPath(args.find((a) => !a.startsWith("--")) ?? "."));
  const { envelope } = loadEnvelope(root, null, pipelineHere(root), { cache: true });
  const inv = buildServiceInventory(envelope, buildStackIndex(envelope, root), root);
  return { exitCode: 0, text: json ? `${JSON.stringify(inv, null, 2)}\n` : servicesPage(inv, basename(root)) };
}
