// `dataflow [<root>] [--json]` (2026-09-29): untrusted input reaching a shell
// command, SQL query text or code evaluation (src/server/dataflow.ts). Zero
// tokens. Exit 1 when something reaches a sink with no condition on the way,
// else 0 — so a CI job can gate on it; the report always states its limits.
import { resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { cachedDataflow } from "../dataflow_cache.mjs";
import { formatDataflowMd } from "../../src/server/dataflow.ts";

export const DATAFLOW_USAGE = `dataflow [<root>] [--json]     untrusted input → shell / SQL text / eval, with the path it took (zero tokens;
                                  exit 1 when something reaches a sink unguarded)`;

export function runDataflow(args) {
  const json = args.includes("--json");
  const root = resolve(args.find((a) => !a.startsWith("--")) ?? ".");
  const { envelope } = loadEnvelope(root, null, {});
  const report = cachedDataflow(envelope, root);
  const high = report.findings.filter((f) => f.severity === "high").length;
  return { exitCode: high ? 1 : 0, text: json ? `${JSON.stringify(report, null, 2)}\n` : formatDataflowMd(report) };
}
