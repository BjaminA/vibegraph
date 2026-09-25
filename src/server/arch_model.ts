// M-ARCH.1 (PLAN-M-ARCH.md) — the DERIVED architecture model.
//
// Archify's picture is a dozen boxes grouped by where they run, with every
// arrow saying what crosses it; its agent authors all of it. This module
// builds the same picture's deterministic stratum from what the envelope
// already says, and nothing else:
//
//   * a CLUSTER is the set of entry points sharing a family (the framework
//     that makes them entries: Next routes and pages are a web app, MCP tool
//     registrations an MCP server, shell/node/command scripts the script
//     quiver, argparse CLIs a pipeline) and a PACKAGE ROOT (the nearest
//     directory with a manifest). Not a graph community: a family is a
//     framework's own contract, a root is a directory someone deploys.
//   * a TOOL node is a stack tool whose role is a boundary (db, cache,
//     queue, platform, model API, HTTP client, agent protocol, cloud,
//     remote — and `unknown`, named rather than hidden) that some cluster's
//     thread actually CALLS.
//   * an EDGE aggregates what the threads say: the hops between clusters
//     (http, command, tool — src/server/crossings.ts) and the boundaries
//     from a cluster's threads to a tool (the contract's attributions). Its
//     protocol is read from the fact (src/shared/arch_protocol.ts); its refs
//     are the call sites, which are also edit addresses.
//
// Pure: inputs in, record out. Contracts are INJECTED (`contractFor`) so the
// server and the export compute them the way they already do.

import { languageForPath } from "../shared/languages.ts";
import {
  BOUNDARY_ROLES, EXEC_TOOLS, NON_CARRIERS, ROLE_CATEGORY, commandProtocol, toolProtocol, type ArchCategory,
} from "../shared/arch_protocol.ts";
import { ROLE_LABEL, jstsPackageName, pythonToolName, type StackRole } from "../shared/stack_taxonomy.ts";
import { cloudServiceOf, type CloudService } from "../shared/cloud_services.ts";
import type {
  ArchEdgeRecord, ArchModelRecord, ArchNodeRecord, ArchRef, CrossingIndexRecord, EntryPoint, StackIndexRecord,
} from "../shared/protocol.ts";
import type { ThreadContract } from "./thread_contract.ts";
import {
  calleePayload, callerPayload, observedPayload, payloadSummary, statedPayloads,
  type PayloadConstraintLike, type PayloadNodeLike,
} from "./arch_payloads.ts";

const MAX_REFS = 8;

export interface ArchInputs {
  entryPoints: EntryPoint[];
  threads: Array<{ entryPointId?: string | null; filesReached?: string[] }>;
  stack: StackIndexRecord | null;
  crossings: CrossingIndexRecord | null;
  /** The thread's contract, or null when none can be computed. */
  contractFor: (entryPointId: string) => ThreadContract | null;
  /** Which file owns a node id — externals carry `file: null`. */
  fileOfNode: (nodeId: string) => string | null;
  /** Project-relative directories holding a package manifest ("" = root). */
  manifestDirs?: string[];
  /** A file's registry language from its IR — an extensionless script
   *  (`bin/orders-cli`) has none by path. */
  languageOf?: (file: string) => string | null;
  /** M-ARCH.3 — a file's IR nodes (a module-seeded script's argv signature). */
  fileNodes?: (file: string) => Array<{ type?: string; name?: string; preview?: string; parentId?: string | null }> | null;
  /** M-ARCH.3 — the IR node at (file, id), for a call site's text and keys. */
  nodeFor?: (file: string | null, nodeId: string | null) => Record<string, unknown> | null;
  /** M-ARCH.3 — stated constraints (payload-schema rules attach to edges). */
  constraints?: PayloadConstraintLike[];
  /** M-ARCH.3 — what trace runs saw at a node (dispatch, never values). */
  observedFor?: (file: string, nodeId: string) => Array<{ callees: Array<{ callee: string; count: number }>; entryPointId: string; at: string; stale: boolean }>;
}

const MAX_PAYLOADS = 4;

/** A DISPATCHER: a script whose own file names at least this many other
 *  scripts it runs, and that at least this many other files name in turn.
 *  a private production codebase's job_orchestrator.sh names 28 and is named by 20 files
 *  (2026-09-24, the script Archify's agent picked out by reading); a helper
 *  that runs two siblings is not a hub. */
export const HUB_MIN_SCRIPTS = 4;
export const HUB_MIN_CALLERS = 2;

// ── clusters ─────────────────────────────────────────────────────────────

interface Family { family: string; label: string; category: ArchCategory }

const SCRIPT_FRAMEWORKS = new Set(["shell", "command", "node", "bun", "deno"]);

/** The family an entry point belongs to, or null (tests are not architecture). */
export function familyOf(e: EntryPoint, language?: string | null): Family | null {
  const fw = e.framework ?? null;
  const lang = language ?? languageForPath(e.file)?.id ?? "";
  switch (e.kind) {
    case "test": return null;
    case "route":
      if (fw === "next") return { family: "web", label: "Next.js app", category: "frontend" };
      if (fw === "mcp") return { family: "mcp", label: "MCP server", category: "agent" };
      // The FRAMEWORK is part of the family for a service: an Express
      // gateway and a Flask service in one repository are two processes,
      // and one cluster would turn every hop between them into an internal
      // one (the fleet example's five, found by the first probe).
      return { family: fw ? `api-${fw}` : "api", label: fw ? `HTTP API (${fw})` : "HTTP API", category: "backend" };
    case "model": return { family: "model", label: "Model", category: "pipeline" };
    case "public_api": return { family: "library", label: "Library", category: "backend" };
    case "cli":
    case "manual":
    default:
      if ((fw && SCRIPT_FRAMEWORKS.has(fw)) || lang === "bash" || (e.kind === "manual" && lang === "jsts")) {
        return { family: "scripts", label: "Scripts", category: "scripts" };
      }
      // No framework: the language names it (a C++ `main`, a Rust bin).
      return { family: fw ? `cli-${fw}` : `cli-${lang || "?"}`, label: fw ? `CLI (${fw})` : `CLI (${lang || "unknown language"})`, category: "pipeline" };
  }
}

/** The nearest manifest directory containing `file` ("" = project root). */
export function packageRootOf(file: string, manifestDirs: string[]): string {
  let best = "";
  for (const d of manifestDirs) {
    if (!d) continue;
    if ((file === d || file.startsWith(d + "/")) && d.length > best.length) best = d;
  }
  return best;
}

// ── the build ────────────────────────────────────────────────────────────

export function buildArchModel(input: ArchInputs): ArchModelRecord {
  const manifestDirs = input.manifestDirs ?? [];
  const epById = new Map(input.entryPoints.map((e) => [e.id, e]));
  const threadByEp = new Map<string, { filesReached?: string[] }>();
  for (const t of input.threads) if (t.entryPointId) threadByEp.set(t.entryPointId, t);

  const clusterOf = new Map<string, string>(); // entryPointId → cluster id
  const clusters = new Map<string, ArchNodeRecord & { _files: Set<string> }>();
  let tests = 0;
  for (const e of input.entryPoints) {
    const fam = familyOf(e, input.languageOf?.(e.file) ?? null);
    if (!fam) { tests++; continue; }
    const root = packageRootOf(e.file, manifestDirs);
    const id = `cluster:${fam.family}:${root || "."}`;
    clusterOf.set(e.id, id);
    let c = clusters.get(id);
    if (!c) {
      c = {
        id, kind: "cluster", label: root ? `${fam.label} · ${root}` : fam.label, sublabel: "",
        category: fam.category, source: "derived", family: fam.family, root,
        entryPoints: [], frameworks: [], threads: [], refs: [], _files: new Set(),
      };
      clusters.set(id, c);
    }
    c.entryPoints!.push(e.id);
    if (e.framework && !c.frameworks!.includes(e.framework)) c.frameworks!.push(e.framework);
    if (threadByEp.has(e.id)) c.threads.push(e.id);
    for (const f of threadByEp.get(e.id)?.filesReached ?? []) c._files.add(f);
    if (c.refs.length < MAX_REFS) c.refs.push({ file: e.file, nodeId: e.irNodeId, text: e.label });
  }

  // ── dispatchers: a scripts-family entry whose own file names ≥ N scripts
  // it runs and which ≥ M other files name. Promoted to its own node so the
  // hops that reach it land on IT, not on the whole script quiver, and its
  // allow-list becomes a browsable list (`dispatches`, grouped by
  // directory). Read from the command hops alone — nothing is inferred.
  const namedBy = new Map<string, Set<string>>();
  for (const hops of Object.values(input.crossings?.byThread ?? {})) {
    for (const h of hops) {
      if ((h.kind ?? "http") !== "command") continue;
      for (const t of h.targets) {
        if (!namedBy.has(t.entryPointId)) namedBy.set(t.entryPointId, new Set());
        namedBy.get(t.entryPointId)!.add(h.file);
      }
    }
  }
  const hubOf = new Map<string, string>(); // dispatcher entry point → hub node id
  const hubs: ArchNodeRecord[] = [];
  for (const [ep, cid] of clusterOf) {
    const c = clusters.get(cid)!;
    const e = epById.get(ep)!;
    if (c.family !== "scripts") continue;
    const targets = new Map<string, { file: string; nodeId: string }>();
    for (const h of input.crossings?.byThread[ep] ?? []) {
      if ((h.kind ?? "http") !== "command" || h.file !== e.file) continue;
      for (const t of h.targets) {
        if (t.entryPointId !== ep && clusterOf.has(t.entryPointId) && !targets.has(t.entryPointId)) {
          targets.set(t.entryPointId, { file: epById.get(t.entryPointId)?.file ?? t.route, nodeId: h.nodeId });
        }
      }
    }
    const callers = [...(namedBy.get(ep) ?? [])].filter((f) => f !== e.file).sort();
    if (targets.size < HUB_MIN_SCRIPTS || callers.length < HUB_MIN_CALLERS) continue;
    const base = e.file.includes("/") ? e.file.slice(0, e.file.lastIndexOf("/")) : "";
    const byDir = new Map<string, Array<{ entryPointId: string; file: string }>>();
    for (const [tid, t] of targets) {
      const rel = relativeTo(base, t.file);
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
      byDir.set(dir, [...(byDir.get(dir) ?? []), { entryPointId: tid, file: t.file }]);
    }
    const id = `hub:${ep}`;
    hubOf.set(ep, id);
    const first = [...targets.values()][0];
    hubs.push({
      id, kind: "hub", label: e.file.slice(e.file.lastIndexOf("/") + 1),
      sublabel: `dispatcher · ${targets.size} scripts · named by ${callers.length} files`,
      category: "scripts", source: "derived", family: "scripts", root: c.root,
      entryPoints: [ep], threads: threadByEp.has(ep) ? [ep] : [],
      refs: [{ file: e.file, nodeId: first.nodeId, text: "allow-list" }],
      cluster: cid, callers,
      dispatches: [...byDir].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dir, scripts]) => ({ dir, scripts: scripts.sort((a, b) => a.file.localeCompare(b.file)) })),
    });
  }

  // ── tools: boundary-role records from the stack ────────────────────────
  const toolRec = new Map((input.stack?.tools ?? []).filter((t) => t.origin !== "project").map((t) => [t.tool, t]));
  const funnelsOf = new Map<string, string[]>();
  for (const t of input.stack?.tools ?? []) {
    if (t.origin !== "project") continue;
    for (const w of t.wraps ?? []) funnelsOf.set(w, [...(funnelsOf.get(w) ?? []), t.tool]);
  }
  const tools = new Map<string, ArchNodeRecord>();
  const toolNode = (name: string, role: string): ArchNodeRecord => {
    let n = tools.get(name);
    if (n) return n;
    const rec = toolRec.get(name);
    const bits = [ROLE_LABEL[role as StackRole] ?? role];
    if (rec?.version) bits.push(`v${rec.version}`);
    n = {
      id: `tool:${name}`, kind: "tool", label: name, sublabel: bits.join(" · "),
      category: ROLE_CATEGORY[role] ?? "unknown", source: "derived",
      tool: name, role, origin: rec?.origin ?? "third-party",
      ...(rec?.version ? { version: rec.version } : {}),
      ...(rec?.roleStatedBy ? { roleStatedBy: rec.roleStatedBy } : {}),
      ...(funnelsOf.get(name)?.length ? { wrappedBy: funnelsOf.get(name) } : {}),
      threads: [], refs: [],
    };
    tools.set(name, n);
    return n;
  };

  // ── cloud SERVICES (2026-09-24): a cloud-role tool is drawn per provider
  // service — "AWS S3", not "@aws-sdk/client-s3" — so one S3 reached by a
  // client, a presigner and `aws s3 cp` is one box (cloud_services.ts).
  const cloudNodes = new Map<string, { node: ArchNodeRecord; pkgs: Set<string>; svc: CloudService }>();
  const cloudNode = (svc: CloudService, pkg: string): ArchNodeRecord => {
    const id = `tool:cloud:${svc.provider}:${svc.service}`;
    let c = cloudNodes.get(id);
    if (!c) {
      c = {
        svc, pkgs: new Set(),
        node: {
          id, kind: "tool", label: svc.label, sublabel: "",
          category: svc.kind === "database" ? "database" : svc.kind === "queue" ? "queue" : "cloud", source: "derived",
          tool: svc.label, role: "cloud", origin: "third-party", threads: [], refs: [],
          notes: [`Service read from the ${svc.from === "none" ? "provider alone — no package name, constructor argument or CLI word names it" : svc.from === "package" ? "package name" : svc.from === "constructor" ? "client constructor's literal argument" : "CLI's first argument"}.`],
        },
      };
      cloudNodes.set(id, c);
      tools.set(id, c.node);
    }
    c.pkgs.add(pkg);
    return c.node;
  };
  const toolNameOf = (lang: string, spec: string) => lang === "python" ? pythonToolName(spec) : lang === "jsts" ? jstsPackageName(spec) : spec;
  /** The service one cloud call reaches: the owning file's import specs for
   *  the tool first (they keep `google.cloud.storage` whole), then the tool
   *  with the constructor or CLI words the IR holds. */
  const serviceOf = (tool: string, file: string | null, lang: string, irNodeId: string | null, label: string): CloudService | null => {
    // `from google.cloud import storage` binds a SUBMODULE: spec + binding
    // is the full name. The binding the call's receiver names comes first.
    const head0 = label.split(".")[0];
    const specs = (input.stack?.importsByFile?.[file ?? ""] ?? [])
      .filter((b) => !b.project && toolNameOf(lang, b.spec) === tool)
      .sort((x, y) => Number(y.binding === head0) - Number(x.binding === head0))
      .flatMap((b) => [b.spec, `${b.spec}.${b.binding}`]);
    for (const s of specs) { const svc = cloudServiceOf(s); if (svc && svc.from !== "none") return svc; }
    const node = file && irNodeId && input.nodeFor ? (input.nodeFor(file, irNodeId) as { args?: string[]; callTarget?: string } | null) : null;
    const args = Array.isArray(node?.args) ? node!.args.filter((a): a is string => typeof a === "string") : [];
    // The receiver's binding: `s3 = boto3.client("s3")` then `s3.upload_file(…)`;
    // `new AWS.S3()` names the service in the constructor itself.
    let ctor: string[] = [];
    const head = label.split(".")[0];
    const bound = file && head !== label ? (input.fileNodes?.(file) ?? []).find((n) => n.type === "assignment" && n.name === head) as { callTarget?: string; args?: string[]; preview?: string } | undefined : undefined;
    const ctorTarget = bound?.callTarget ?? node?.callTarget ?? "";
    if (/(^|\.)(client|resource)$/.test(ctorTarget)) ctor = (bound?.args ?? args).filter((a): a is string => typeof a === "string");
    else if (/^AWS\.[A-Za-z0-9]+$/.test(ctorTarget)) ctor = [ctorTarget.slice(4)];
    return cloudServiceOf(tool, { constructorArgs: ctor.length ? ctor : args, cliArgs: args });
  };

  // The one platform client a cluster's files import, when there is exactly
  // one: the last-resort carrier for a command hop whose carrying call takes
  // the client as a VALUE (`runVoltCommandStream(voltClient, …)` — a real
  // codebase's 128 hops). Two platforms in one cluster name neither.
  const clusterPlatform = new Map<string, { tool: string; role: string }>();
  for (const c of clusters.values()) {
    const found = new Set<string>();
    for (const f of c._files) {
      for (const name of input.stack?.byFile[f] ?? []) {
        const r = toolRec.get(name);
        if (r && r.role === "platform" && !NON_CARRIERS.has(name)) found.add(name);
      }
    }
    if (found.size === 1) {
      const name = [...found][0];
      clusterPlatform.set(c.id, { tool: name, role: "platform" });
    }
  }

  // ── edges ──────────────────────────────────────────────────────────────
  const edges = new Map<string, ArchEdgeRecord & { _threads: Set<string>; _confs: Set<string>; _details: Set<string>; _via: Set<string>; _pay: Map<string, import("../shared/protocol.ts").ArchPayloadRecord> }>();
  // M-ARCH.3 — one caller/observed record per distinct text, capped.
  const addPayload = (e: { _pay: Map<string, import("../shared/protocol.ts").ArchPayloadRecord> }, p: import("../shared/protocol.ts").ArchPayloadRecord | null) => {
    if (!p) return;
    const key = `${p.side}|${p.text}`;
    if (e._pay.has(key)) return;
    if ([...e._pay.values()].filter((x) => x.side === p.side).length >= MAX_PAYLOADS) return;
    e._pay.set(key, p);
  };
  const nodeAt = (file: string | null, id: string | null): PayloadNodeLike | null =>
    (input.nodeFor && file && id ? (input.nodeFor(file, id) as PayloadNodeLike | null) : null);
  const edge = (from: string, to: string, kind: ArchEdgeRecord["kind"], proto: { protocol: string; basis: string; presence?: true }) => {
    const id = `${from}->${to}:${kind}:${proto.protocol}${proto.presence ? ":presence" : ""}`;
    let e = edges.get(id);
    if (!e) {
      e = {
        id, from, to, kind, protocol: proto.protocol, protocolBasis: proto.basis,
        ...(proto.presence ? { protocolPresence: true as const } : {}), count: 0,
        threads: [], confidence: "called", refs: [], source: "derived",
        _threads: new Set(), _confs: new Set(), _details: new Set(), _via: new Set(), _pay: new Map(),
      };
      edges.set(id, e);
    }
    return e;
  };

  const unmatched = new Set<string>();
  const unattributedSites = new Set<string>();
  const toolsPresent = new Set<string>();
  const toolsCalled = new Set<string>();

  for (const [ep, cid] of clusterOf) {
    const c = clusters.get(cid)!;
    const contract = threadByEp.has(ep) ? input.contractFor(ep) : null;
    const epFile = epById.get(ep)!.file;
    const lang = input.languageOf?.(epFile) ?? languageForPath(epFile)?.id ?? "";

    // tools this thread CALLS, by the contract's attributions
    if (contract) {
      // DISTINCT call sites: threads overlap, and summing each thread's own
      // count read 14069 on a real codebase for what is a few hundred sites.
      for (const x of contract.externals) if (!x.tool && x.irNodeId) unattributedSites.add(`${input.fileOfNode(x.irNodeId) ?? ""}|${x.irNodeId}`);
      for (const x of contract.externals) {
        const a = x.tool;
        if (!a || a.how === "builtin" || a.how === "local-literal" || a.projectModule || a.origin === "project") continue;
        if (!BOUNDARY_ROLES.has(a.role)) continue;
        const file = x.irNodeId ? input.fileOfNode(x.irNodeId) : null;
        const fileLang = file ? (input.languageOf?.(file) ?? languageForPath(file)?.id ?? lang) : lang;
        const svc = a.role === "cloud" ? serviceOf(a.tool, file, fileLang, x.irNodeId ?? null, x.label) : null;
        const t = svc ? cloudNode(svc, a.tool) : toolNode(a.tool, a.role);
        toolsCalled.add(a.tool);
        if (!t.threads.includes(ep)) t.threads.push(ep);
        const ref: ArchRef = { file: file ?? "", ...(x.irNodeId ? { nodeId: x.irNodeId } : {}), text: (x.preview ?? x.label).slice(0, 160) };
        if (file && t.refs.length < MAX_REFS) t.refs.push(ref);
        const e = edge(cid, t.id, "uses", toolProtocol(a.tool, a.role));
        e.count++;
        e._threads.add(ep);
        e._confs.add("called");
        if (a.via) e._via.add(a.via);
        if (file && e.refs.length < MAX_REFS) e.refs.push(ref);
        if (file && x.irNodeId) {
          addPayload(e, callerPayload(nodeAt(file, x.irNodeId), ref));
          if (input.observedFor) addPayload(e, observedPayload(input.observedFor(file, x.irNodeId), ref));
        }
      }
      for (const s of contract.stack) {
        if (s.origin !== "project" && BOUNDARY_ROLES.has(s.role)) toolsPresent.add(s.tool);
      }
    }

    // hops out of this thread. A dispatcher's hops leave from ITS node, and
    // a hop that reaches a dispatcher from another cluster lands on it.
    const from = hubOf.get(ep) ?? cid;
    for (const h of input.crossings?.byThread[ep] ?? []) {
      const kind = (h.kind ?? "http") as "http" | "command" | "tool";
      if (!h.targets.length) { unmatched.add(`${h.file}|${h.nodeId}|${h.path}`); continue; }
      for (const t of h.targets) {
        const targetCluster = clusterOf.get(t.entryPointId);
        if (!targetCluster) continue; // a test target: not in the picture
        const hubTarget = hubOf.get(t.entryPointId);
        const to = hubTarget && targetCluster !== cid ? hubTarget : targetCluster;
        if (to === cid && from === cid) {
          c.internalHops = c.internalHops ?? {};
          c.internalHops[kind] = (c.internalHops[kind] ?? 0) + 1;
          continue;
        }
        let proto: { protocol: string; basis: string };
        if (kind === "http") proto = { protocol: "HTTP", basis: "the caller's URL shape matches a route this project serves" };
        else if (kind === "tool") proto = { protocol: "MCP", basis: "a tool name the caller dispatches matches a registration" };
        else proto = commandProtocol(carrierFor(contract, input.stack, ep, h.file, input.fileOfNode, clusterPlatform.get(cid) ?? null), lang);
        const e = edge(from, to, kind, proto);
        e.count++;
        e._threads.add(ep);
        e._confs.add(h.confidence);
        if (kind === "http" && h.method) e._details.add(h.method);
        if (kind === "tool") e._details.add(h.path);
        const hopRef = { file: h.file, nodeId: h.nodeId, text: `${h.callee} ${h.path}`.slice(0, 160) };
        if (e.refs.length < MAX_REFS) e.refs.push(hopRef);
        addPayload(e, callerPayload(nodeAt(h.file, h.nodeId), hopRef));
        const targetEp = epById.get(t.entryPointId);
        const targetNodes = targetEp?.irNodeId === "module" && input.nodeFor
          ? scriptNodes(input, targetEp.file) : undefined;
        addPayload(e, calleePayload(input.contractFor(t.entryPointId), { file: targetEp?.file ?? t.route, ...(targetEp?.irNodeId ? { nodeId: targetEp.irNodeId } : {}) }, targetNodes));
      }
    }
  }

  // ── finalise ───────────────────────────────────────────────────────────
  const RANK: Record<string, number> = { ambiguous: 0, path: 1, "path+method": 2, called: 3 };
  const edgeList: ArchEdgeRecord[] = [...edges.values()].map(({ _threads, _confs, _details, _via, _pay, ...e }) => {
    const threads = [..._threads].sort();
    const files = [...new Set([...e.refs.map((r) => r.file), ...(_pay.size ? [..._pay.values()].map((p) => p.where?.file ?? "") : [])])].filter(Boolean);
    const payloads = [..._pay.values(), ...statedPayloads(input.constraints ?? [], threads, files)];
    const summary = payloadSummary(payloads, e.kind === "uses" ? e.to.replace(/^tool:/, "") : undefined);
    return {
    ...e,
    ...(payloads.length ? { payloads } : {}),
    ...(summary ? { payloadSummary: summary } : {}),
    threads,
    confidence: [..._confs].sort((a, b) => RANK[a] - RANK[b])[0] as ArchEdgeRecord["confidence"],
    ...(_details.size ? { details: [..._details].sort() } : {}),
    ...(_via.size ? { via: [..._via].sort() } : {}),
  }; }).sort((a, b) => a.id.localeCompare(b.id));

  const nodes: ArchNodeRecord[] = [];
  for (const { _files, ...c } of [...clusters.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const n = c.entryPoints!.length;
    nodes.push({
      ...c, files: _files.size,
      sublabel: `${n} entry point${n === 1 ? "" : "s"} · ${_files.size} file${_files.size === 1 ? "" : "s"}${c.frameworks!.length ? ` · ${c.frameworks!.join(", ")}` : ""}`,
    });
  }
  for (const c of cloudNodes.values()) {
    const kind = c.svc.kind === "object-storage" ? "object storage" : c.svc.kind;
    c.node.sublabel = `${kind} · ${[...c.pkgs].sort().join(", ")}`;
  }
  nodes.push(...hubs.sort((a, b) => a.id.localeCompare(b.id)));
  nodes.push(...[...tools.values()].sort((a, b) => a.id.localeCompare(b.id)));

  const unmatchedHops = unmatched.size;
  const unattributed = unattributedSites.size;
  const notes: string[] = [];
  if (tests) notes.push(`${tests} test entry point(s) are not architecture and are left out of the picture.`);
  if (unmatchedHops) notes.push(`${unmatchedHops} hop(s) name nothing this project parses (flows.md lists them with the reason).`);
  if (unattributed) notes.push(`${unattributed} distinct boundary call site(s) on cluster threads reach no tool an attribution rule could name — they are not drawn.`);

  return {
    version: "1",
    nodes,
    edges: edgeList,
    groups: [],
    unplaced: {
      tests, unmatchedHops,
      toolsPresentNotCalled: [...toolsPresent].filter((t) => !toolsCalled.has(t)).sort(),
      unattributedBoundaries: unattributed,
    },
    notes,
  };
}

/** `file` relative to directory `base`, with `../` where it sits outside
 *  (a dispatcher's allow-list names siblings as `../grants/x.sh`). */
export function relativeTo(base: string, file: string): string {
  const b = base ? base.split("/") : [];
  const f = file.split("/");
  let i = 0;
  while (i < b.length && i < f.length - 1 && b[i] === f[i]) i++;
  return [...b.slice(i).map(() => ".."), ...f.slice(i)].join("/");
}

/** A script file's top-level nodes, for its argv signature. */
function scriptNodes(input: ArchInputs, file: string): Array<{ type?: string; name?: string; preview?: string; parentId?: string | null }> | undefined {
  return input.fileNodes?.(file) ?? undefined;
}

/** The platform tool that carries a command hop from this thread: one its
 *  boundaries CALL, else one its files import. */
function carrierFor(
  contract: ThreadContract | null, stack: StackIndexRecord | null, ep: string,
  hopFile: string, fileOfNode: (id: string) => string | null,
  clusterPlatform: { tool: string; role: string } | null,
): { tool: string; role: string; how: "called" | "present" | "cluster"; via?: string } | null {
  const isCarrier = (tool: string, role: string) =>
    !NON_CARRIERS.has(tool) && (role === "platform" || role === "remote" || role === "process" || EXEC_TOOLS.has(tool));
  if (contract) {
    const carriers = contract.externals.filter((x) => x.tool && x.tool.origin !== "project" && isCarrier(x.tool.tool, x.tool.role));
    // The call in the SAME file as the literal is the one that sends it; a
    // thread may touch two platforms (a ledger SDK beside the Volt client).
    const same = carriers.find((x) => x.irNodeId && fileOfNode(x.irNodeId) === hopFile);
    const pick = same ?? carriers[0];
    if (pick?.tool) return { tool: pick.tool.tool, role: pick.tool.role, how: "called" };
  }
  const present = new Set(stack?.byThread[ep] ?? []);
  for (const t of stack?.tools ?? []) {
    if (t.origin !== "project" && (t.role === "platform" || t.role === "remote") && present.has(t.tool) && !NON_CARRIERS.has(t.tool)) {
      return { tool: t.tool, role: t.role, how: "present" };
    }
  }
  // A project funnel the thread's files import, wrapping a platform tool.
  for (const t of stack?.tools ?? []) {
    if (t.origin !== "project" || !present.has(t.tool) || t.role !== "platform") continue;
    const wrapped = (t.wraps ?? []).find((w) => !NON_CARRIERS.has(w));
    if (wrapped) return { tool: wrapped, role: "platform", how: "present", via: t.tool };
  }
  return clusterPlatform ? { ...clusterPlatform, how: "cluster" } : null;
}
