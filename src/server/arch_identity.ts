// WHO A PROCESS RUNS AS, FROM EVIDENCE (2026-10-06, direction review M4). The
// plan may NAME an identity; only the code can show one. Three kinds:
//
//   env      the process reads an identity-shaped environment variable
//            (`…_PERSON`, `…_USER`, `…_ROLE`, `…_ACCOUNT`, `…_IDENTITY`,
//            `…_PRINCIPAL`, credentials, a key file — or a `…CONFIG_PATH`
//            when the process holds a platform / database / cloud client,
//            whose config IS its identity);
//   given    a project file that spawns it passes such a variable in the
//            spawn's `env` (`spawn(…, { env: { RUN_CONFIG_PATH } })`);
//   created  the file that spawns it creates an identity for the run
//            (`createRunIdentity`, `createAccount`, `mintKey`, …).
//
// No evidence, no identity: an offline CLI that touches no client shows none,
// whatever the plan says it runs as. Read from IR facts (envReads, call
// nodes, the command hops), never from source text.

import type { ArchModelRecord, ArchNodeRecord, CrossingIndexRecord } from "../shared/protocol.ts";
import { payloadKeys } from "./arch_payloads.ts";
import { importGraph } from "./import_graph.ts";

type Files = Record<string, { nodes?: any[]; envReads?: Array<{ name: string; line?: number }> }>;

const IDENTITY_ENV = /(^|_)(PERSON|USER|USERNAME|PRINCIPAL|IDENTITY|ACCOUNT|ROLE|CREDENTIALS?|SERVICE_ACCOUNT|KEY_?FILE|KEY_?PATH)$/;
const CLIENT_CONFIG = /(^|_)CONFIG(_PATH|_FILE)?$/;
const CREATES = /^(create|make|mint|new|issue|provision|register)\w*(Identity|Identities|Account|Principal|Credentials?|Keypair|KeyPair|Did)$/;
const CLIENT_ROLES = new Set(["platform", "db", "cloud", "queue", "cache", "model-api"]);
const IDENTITY_CAP = 6;

export function stampIdentity(
  model: ArchModelRecord,
  files: Files,
  threads: Array<{ entryPointId?: string | null; filesReached?: string[] }>,
  crossings: CrossingIndexRecord | null,
): ArchModelRecord {
  const reached = new Map(threads.filter((t) => t.entryPointId).map((t) => [t.entryPointId as string, t.filesReached ?? []]));
  // a settings module is IMPORTED, not called: the files a process reaches,
  // plus what they import one hop on, are where it reads its environment
  const imports = new Map<string, string[]>();
  for (const e of importGraph(files)) if (e.to) imports.set(e.from, [...(imports.get(e.from) ?? []), e.to]);
  const toolRole = new Map(model.nodes.filter((n) => n.kind === "tool").map((n) => [n.id, n.role ?? ""]));
  const holdsClient = (cid: string) => model.edges.some((e) => e.from === cid && e.kind === "uses" && CLIENT_ROLES.has(toolRole.get(e.to) ?? ""));
  const nodes = model.nodes.map((n): ArchNodeRecord => {
    if (n.kind !== "cluster" || !n.entryPoints?.length) return n;
    const out: NonNullable<ArchNodeRecord["identity"]> = [];
    const add = (x: NonNullable<ArchNodeRecord["identity"]>[number]) => { if (!out.some((y) => y.kind === x.kind && y.name === x.name)) out.push(x); };
    const client = holdsClient(n.id);
    // env: what its own files read
    const walked = n.entryPoints.flatMap((ep) => [ep.replace(/:[^:]*$/, ""), ...(reached.get(ep) ?? [])]);
    const own = new Set([...walked, ...walked.flatMap((f) => imports.get(f) ?? [])]);
    for (const f of [...own].sort()) {
      for (const r of files[f]?.envReads ?? []) {
        if (IDENTITY_ENV.test(r.name) || (client && CLIENT_CONFIG.test(r.name))) add({ kind: "env", name: `$${r.name}`, evidence: `${f}:${r.line ?? "?"} reads ${r.name}` });
      }
    }
    // given / created: by the files that spawn it
    for (const h of crossings?.all ?? []) {
      // an ambiguous hop (one literal, several parsed files) is evidence for none
      if (h.kind !== "command" || h.targets.length !== 1 || !n.entryPoints!.includes(h.targets[0].entryPointId)) continue;
      const call = (files[h.file]?.nodes ?? []).find((x: any) => x.id === h.nodeId && (h.line === undefined || x.line === h.line));
      const envKeys = (call ? payloadKeys(call) : []).filter((k) => k.startsWith("env.")).map((k) => k.slice(4));
      for (const k of envKeys) if (IDENTITY_ENV.test(k) || CLIENT_CONFIG.test(k)) add({ kind: "given", name: `$${k}`, evidence: `${h.file}:${h.line ?? "?"} starts it with ${k} set` });
      // a call, or an assignment whose value is one (`const cfg = await createRunAccount(…)`)
      const maker = (files[h.file]?.nodes ?? []).find((x: any) => (x.type === "call" || x.callTarget) && CREATES.test(String(x.callTarget ?? x.funcName ?? "").replace(/^await\s+/, "").split(".").pop() ?? ""));
      if (maker) add({ kind: "created", name: "its own identity, per run", evidence: `${h.file}:${maker.line ?? "?"} calls ${String(maker.callTarget ?? maker.funcName)} before starting it` });
    }
    // strongest first — an identity created for it, then one handed to it,
    // then what it reads itself — and capped
    const rank = { created: 0, given: 1, env: 2 } as const;
    out.sort((a, b) => rank[a.kind] - rank[b.kind]);
    // M12: the port a listening process binds, read off its own listen call
    const port = n.runtime?.how.includes("listens") ? listenPort(files, n.entryPoints.map((ep) => ep.replace(/:[^:]*$/, ""))) : null;
    const withPort = port ? { ...n, runtime: { ...n.runtime!, port } } : n;
    return out.length ? { ...withPort, identity: out.slice(0, IDENTITY_CAP) } : withPort;
  });
  return { ...model, nodes };
}

/** `server.listen(8080)`, `listen(PORT)` with `const PORT = Number(process.env.PORT ?? 8080)`:
 *  "8080", or "$PORT" when only the variable is known. One hop, literals only. */
export function listenPort(files: Files, entryFiles: string[]): string | null {
  const read = (text: string): string | null => {
    const lit = /^\s*["']?(\d{2,5})["']?\s*$/.exec(text);
    if (lit) return lit[1];
    const env = /process\.env\.([A-Z_][A-Z0-9_]*)(?:\s*(?:\?\?|\|\|)\s*["']?(\d{2,5}))?/.exec(text) ?? /environ(?:\.get\(|\[)\s*["']([A-Z_][A-Z0-9_]*)["'](?:\s*,\s*["']?(\d{2,5}))?/.exec(text);
    return env ? (env[2] ?? `$${env[1]}`) : null;
  };
  for (const f of entryFiles) {
    const nodes: any[] = files[f]?.nodes ?? [];
    for (const c of nodes) {
      const callee = String(c.funcName ?? c.callTarget ?? "").replace(/^await\s+/, "");
      if (!/(^|\.)listen$/.test(callee) || !c.args?.length) continue;
      const a = String(c.args[0]);
      const direct = read(a);
      if (direct) return direct;
      const bound = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(a) ? nodes.find((x) => x.type === "assignment" && x.name === a.trim() && !x.parentId) : null;
      const via = bound ? read(String(bound.preview ?? (bound.args ?? []).join(" "))) : null;
      if (via) return via;
    }
  }
  return null;
}
