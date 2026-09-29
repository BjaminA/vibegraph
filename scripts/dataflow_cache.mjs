// The untrusted-input report (src/server/dataflow.ts), cached beside the
// envelope and keyed on the IR itself: it changes only when some file's IR
// does. The pass costs ~1.4 s on a private production codebase; the prompt hook asks on every
// prompt that routes a thread, so it must not pay that each time.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDirFor } from "./envelope_cache.mjs";
import { computeDataflow } from "../src/server/dataflow.ts";

const findingKey = (f) => `${f.kind}|${f.sink.file}|${f.sink.fn}|${f.sink.text.split("(")[0]}|${f.source.what}`;

/** The hooks: record the session's untrusted-input findings at its first
 *  prompt; after an edit, an ADVISORY note naming each unguarded flow that
 *  was not there then (never blocking — it is a place to look). */
export function untrustedBaseline(env, absRoot, state) {
  if (state.dataflowBaseline) return;
  try { state.dataflowBaseline = cachedDataflow(env, absRoot).findings.map(findingKey); } catch { state.dataflowBaseline = []; }
}
export function newUntrustedNote(env, absRoot, state) {
  if (!state.dataflowBaseline) return null;
  let report;
  try { report = cachedDataflow(env, absRoot); } catch { return null; }
  const seen = new Set(state.dataflowBaseline);
  const fresh = report.findings.filter((f) => f.severity === "high" && !seen.has(findingKey(f)));
  if (!fresh.length) return null;
  for (const f of fresh) state.dataflowBaseline.push(findingKey(f));
  return `New since the session began — untrusted input now reaches a dangerous sink with no check on the way (advisory; \`vibegraph-knowledge dataflow\` has the limits):\n${fresh.slice(0, 4).map((f) => `- ${f.kind} \`${f.sink.text.replace(/\s+/g, " ").slice(0, 90)}\` (${f.sink.file}${f.sink.line ? `:${f.sink.line}` : ""}) from ${f.source.what} via ${f.path.join(" → ")}`).join("\n")}`;
}

export function cachedDataflow(env, absRoot) {
  const h = createHash("sha1");
  for (const f of Object.keys(env.files).sort()) h.update(f).update(JSON.stringify(env.files[f].nodes ?? [])).update(JSON.stringify(env.files[f].edges ?? []));
  h.update(JSON.stringify((env.entryPoints ?? []).map((e) => [e.id, e.kind, e.framework ?? null])));
  const key = h.digest("hex");
  const file = join(cacheDirFor(absRoot), "dataflow.json");
  try {
    const c = JSON.parse(readFileSync(file, "utf-8"));
    if (c.key === key) return c.report;
  } catch { /* build */ }
  const report = computeDataflow(env);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ key, report }));
  } catch { /* only slower */ }
  return report;
}
