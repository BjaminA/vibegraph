// `topology` — the DECLARED topology (2026-10-02). Zero tokens. A generator
// is the project's own command; it runs only when asked (`run`, `export`).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { cliPath } from "./winpath.mjs";
import { TOPOLOGY_DIR, loadSources, loadTopology, runSource, saveSources, sourceStatus, validateSource, validateTopology } from "../../src/server/topology_store.ts";
import { formatTopologyMd } from "../../src/server/topology_render.ts";
import { mayAccess, threadsTouching, whoMay, TOPOLOGY_QUERY_LIMITS } from "../../src/shared/topology_query.ts";
import { decisionChain, diffTopology, driftCount, formatChain, parseTrace, replayTrace } from "../../src/shared/topology_analysis.ts";
import { loadEnvelope } from "../quality_check.mjs";
import { pipelineHere } from "./pipeline.mjs";

export const TOPOLOGY_USAGE = `topology add <id> --generator "<cmd>" --inputs <globs> | remove <id> | list | run [<id>] | show | check
              | who-writes <zone> | can-write <principal> | touches <family> | explain <tree>:<node>
              | live --command "<read-only cmd>" | trace <events.jsonl> [--save <name>]   [--root <dir>] [--json]
                                  the DECLARED topology — stores, zones, families, principals, grants, routers, state
                                  machines and decision trees — printed as JSON by the project's own generator
                                  (.vibegraph/topology/); zero tokens; see docs/guide/TOPOLOGY.md`;

const list = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function runTopology(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      root: { type: "string" }, json: { type: "boolean" }, generator: { type: "string" }, inputs: { type: "string" },
      command: { type: "string" }, save: { type: "string" },
    } });
  } catch (e) { return { exitCode: 2, text: `${e.message}\n\nusage: vibegraph-knowledge ${TOPOLOGY_USAGE}\n` }; }
  const [sub, arg] = parsed.positionals;
  const root = resolve(cliPath(parsed.values.root ?? "."));
  const done = (text, exitCode = 0) => ({ exitCode, text: text.endsWith("\n") ? text : `${text}\n` });
  const asJson = (x, code = 0) => done(JSON.stringify(x, null, 2), code);
  const envOf = () => { try { return loadEnvelope(root, null, pipelineHere(root), { cache: true }).envelope; } catch { return { threads: [], files: {} }; } };
  const threads = () => envOf().threads ?? [];

  if (sub === "add") {
    const src = { id: arg, generator: parsed.values.generator, inputs: list(parsed.values.inputs) };
    const bad = validateSource(src);
    if (bad) return done(`refused: ${bad}`, 2);
    saveSources(root, [...loadSources(root).filter((s) => s.id !== src.id), src]);
    const r = runSource(root, src);
    return done(`registered ${src.id} (\`${src.generator}\` over ${src.inputs.join(", ")})\n${r.ok ? `generated — ${r.detail}` : `NOT generated: ${r.detail}`}`, r.ok ? 0 : 1);
  }
  if (sub === "remove") {
    const all = loadSources(root);
    if (!all.some((s) => s.id === arg)) return done(`no topology source ${arg ?? ""}`, 1);
    saveSources(root, all.filter((s) => s.id !== arg));
    return done(`removed ${arg} (its last output stays on disk until the next export)`);
  }
  if (sub === "run") {
    const targets = loadSources(root).filter((s) => !arg || s.id === arg);
    if (!targets.length) return done(arg ? `no topology source ${arg}` : "no topology sources — vibegraph-knowledge topology add <id> --generator \"<cmd>\" --inputs <globs>", 1);
    const lines = targets.map((s) => { const r = runSource(root, s); return `${s.id}: ${r.ok ? r.detail : `FAILED — ${r.detail}`}`; });
    return done(lines.join("\n"), lines.some((l) => l.includes("FAILED")) ? 1 : 0);
  }
  if (sub === "list" || sub === "check") {
    const st = loadSources(root).map((s) => sourceStatus(root, s));
    if (parsed.values.json) return asJson(st);
    if (!st.length) return done("no topology sources registered");
    const text = st.map((s) => `${s.state.padEnd(9)} ${s.source.id} — ${s.detail}`).join("\n");
    return done(text, sub === "check" && st.some((s) => s.state !== "fresh") ? 1 : 0);
  }
  const model = loadTopology(root);
  const t = model.topology;
  if (sub === "show") { const env = envOf(); return parsed.values.json ? asJson(model) : done(formatTopologyMd(model, env.threads ?? [], env.files ?? {})); }
  if (sub === "who-writes") {
    const w = whoMay(t, arg ?? "", "write");
    if (parsed.values.json) return asJson(w);
    if (!(t.zones ?? []).some((z) => z.id === arg)) return done(`zone ${arg} is not in the declared topology`, 1);
    return done(w.length ? w.map((x) => `${x.principal}${x.via !== "direct" ? ` (via ${x.via})` : ""}${x.grant.cite ? ` — ${x.grant.cite}` : ""}`).join("\n") : `no declared grant lets anyone write ${arg}`);
  }
  if (sub === "can-write") {
    const z = mayAccess(t, arg ?? "", "write");
    if (parsed.values.json) return asJson(z);
    if (!(t.principals ?? []).some((p) => p.id === arg)) return done(`${arg} is not a declared principal`, 1);
    return done(z.length ? z.map((x) => `${x.zone}${x.via !== "direct" ? ` (via ${x.via})` : ""}${x.grant.cite ? ` — ${x.grant.cite}` : ""}`).join("\n") : `${arg} may write no declared zone`);
  }
  if (sub === "touches") {
    const env = envOf();
    const hits = threadsTouching(t, arg ?? "", env.threads ?? [], env.files ?? {});
    if (parsed.values.json) return asJson(hits);
    return done(`${hits.length ? hits.map((h) => `${h.entryPointId} — ${h.at}`).join("\n") : `no thread names ${arg} as a literal`}\n(${TOPOLOGY_QUERY_LIMITS[1]})`);
  }
  if (sub === "explain") {
    const [tree, node] = String(arg ?? "").split(":");
    const ch = decisionChain(t, tree, node);
    if (!ch) return done(`no decision node ${arg} (give <tree>:<node>)`, 1);
    return parsed.values.json ? asJson(ch) : done(formatChain(ch));
  }
  if (sub === "live") {
    // The platform's ACTUAL resources and grants, from a read-only command
    // the person supplies. VibeGraph runs it once and writes nothing to the
    // platform — the command must be read-only; that is the person's word.
    if (!parsed.values.command) return done("live needs --command \"<read-only command printing the topology JSON>\"", 2);
    const r = spawnSync(parsed.values.command, { cwd: root, shell: true, encoding: "utf-8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    if (r.error || r.status !== 0) return done(`the live command failed: ${r.error?.message ?? `exit ${r.status}`} ${String(r.stderr ?? "").slice(0, 300)}`, 2);
    let live;
    try { live = JSON.parse(r.stdout); } catch (e) { return done(`the live command's output is not JSON: ${e.message}`, 2); }
    const bad = validateTopology(live);
    if (bad) return done(`the live inventory is not a valid topology: ${bad}`, 2);
    mkdirSync(join(root, TOPOLOGY_DIR), { recursive: true });
    writeFileSync(join(root, TOPOLOGY_DIR, "live.json"), JSON.stringify({ at: new Date().toISOString(), command: parsed.values.command, topology: live }, null, 2) + "\n");
    const d = diffTopology(t, live);
    if (parsed.values.json) return asJson(d, driftCount(d) ? 1 : 0);
    const sec = (title, xs) => (xs.length ? [`${title} (${xs.length}):`, ...xs.map((x) => `  ${x}`)] : []);
    const lines = [...sec("On the platform, not declared — zones", d.undeclaredZones), ...sec("On the platform, not declared — stores", d.undeclaredStores),
      ...sec("Declared, not on the platform — zones", d.missingZones), ...sec("Declared grants the platform does not have", d.missingGrants), ...sec("Grants on the platform the declaration does not have", d.extraGrants)];
    return done(lines.length ? lines.join("\n") : "no drift: the platform has exactly the declared zones and grants", driftCount(d) ? 1 : 0);
  }
  if (sub === "trace") {
    let text;
    try { text = readFileSync(resolve(cliPath(arg ?? "")), "utf-8"); } catch (e) { return done(`trace needs a JSON-lines file: ${e.message}`, 2); }
    const { events, errors } = parseTrace(text);
    const steps = replayTrace(t, events);
    if (parsed.values.save) {
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(parsed.values.save)) return done("--save needs a short lower-case name", 2);
      mkdirSync(join(root, TOPOLOGY_DIR, "traces"), { recursive: true });
      copyFileSync(resolve(cliPath(arg)), join(root, TOPOLOGY_DIR, "traces", `${parsed.values.save}.jsonl`));
    }
    if (parsed.values.json) return asJson({ steps, errors }, steps.some((s) => s.flags.length) || errors.length ? 1 : 0);
    const lines = steps.map((s) => `${String(s.i + 1).padStart(3)}. ${s.event.actor} ${s.event.action}${s.event.zone ? ` ${s.event.zone}` : ""}${s.event.document ? ` ${s.event.document}` : ""}${s.event.decision ? ` [${s.event.decision}]` : ""}${s.flags.length ? `  ← ${s.flags.join("; ")}` : ""}`);
    const flagged = steps.filter((s) => s.flags.length).length;
    return done([...lines, ...errors.map((e) => `  ${e}`), `${steps.length} event(s), ${flagged} against the declaration${parsed.values.save ? `; saved for the view as ${parsed.values.save}` : ""}`].join("\n"), flagged || errors.length ? 1 : 0);
  }
  return done(`usage: vibegraph-knowledge ${TOPOLOGY_USAGE}`, 2);
}
