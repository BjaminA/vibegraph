// THE EXTERNAL-SERVICE INVENTORY (2026-10-22, the root-cause handoff RC3:
// "process boundaries stop at subprocess, so services behind CLIs, constants
// and configs vanish"). Four kinds of evidence, each kept with its site:
//
//   program     a program the code runs: a resolved launch (process_launches.ts)
//               or a known command word in a shell script
//   host        a host a request reaches: a URL literal in the call, or one held
//               in a constant or an env default the call names
//   credential  an environment variable a vendor's SDK reads for its key
//   deploy      a platform's deploy file and what it names; a CI workflow and
//               the services its steps use
//
// The tables that turn evidence into a service name are data
// (src/shared/service_tables.ts); what no table knows is listed as itself.
// The architecture gate reads it (servicesNamedWithout): a model may label a
// node, and a label naming a service that node has no evidence for is refused.

import { processLaunches, valueOf } from "./process_launches.ts";
import { readInfraManifests, readManifest, type InfraFact } from "./infra_manifests.ts";
import { BASH_TOOLS, BASH_BUILTINS, pythonToolName, jstsPackageName } from "../shared/stack_taxonomy.ts";
import {
  DEPLOY_FILES, EXECUTABLE_SERVICES, HOST_SERVICES, KEY_SERVICES, WORKFLOW_SERVICES,
  serviceOfExecutable, serviceOfHost, serviceOfKey,
} from "../shared/service_tables.ts";
import type { ProgramEntry, ServiceEntry, ServiceEvidence, ServiceInventory } from "../shared/services.ts";

interface IrNode { id: string; type: string; line?: number; parentId?: string | null; funcName?: string; callTarget?: string; args?: string[]; preview?: string; effectKind?: string | null }
interface EnvLike { files: Record<string, { language?: string; nodes?: IrNode[]; envReads?: Array<{ name: string; line?: number }> }> }
interface StackLike { importsByFile?: Record<string, Array<{ binding: string; spec: string; project?: boolean }>> }

const URL_RE = /\bhttps?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?::\d+)?/g;
const IDENT = /[A-Za-z_$][\w$]*/g;
const RUNTIME_WORDS = new Set(["python", "python3", "node", "bash", "sh"]);

/** The library a call leaves through: its receiver's import, else its head. */
function libraryOf(callee: string, file: string, lang: string, stack: StackLike): string {
  const head = callee.split(".")[0];
  const b = (stack.importsByFile?.[file] ?? []).find((x) => x.binding === head && !x.project);
  if (b) return lang === "jsts" ? jstsPackageName(b.spec) : pythonToolName(b.spec);
  return head;
}

/** Every host a request names, directly or through a constant. */
function hostsOf(n: IrNode, nodes: IrNode[]): Array<{ host: string; url: string }> {
  const text = [...(n.args ?? []), n.preview ?? ""].join(" ");
  const out = new Map<string, string>();
  for (const m of text.matchAll(URL_RE)) out.set(m[1].toLowerCase(), m[0]);
  for (const id of new Set(text.match(IDENT) ?? [])) {
    const v = valueOf(id, nodes, n.parentId ?? null);
    if (!v) continue;
    for (const m of v.value.matchAll(URL_RE)) out.set(m[1].toLowerCase(), m[0]);
  }
  return [...out].map(([host, url]) => ({ host, url }));
}

export function buildServiceInventory(env: EnvLike, stack: StackLike, root: string | null, infra?: { facts: InfraFact[]; files: string[] }): ServiceInventory {
  const services = new Map<string, ServiceEntry>();
  const add = (name: string, e: ServiceEvidence, files: string[] = [e.file]) => {
    const s = services.get(name) ?? { name, via: [], files: [], evidence: [] };
    if (!s.via.includes(e.via)) s.via.push(e.via);
    for (const f of files) if (!s.files.includes(f)) s.files.push(f);
    s.evidence.push(e);
    services.set(name, s);
  };

  // programs
  const programs = new Map<string, ProgramEntry>();
  const ran = (name: string, site: ProgramEntry["sites"][number]) => {
    const p = programs.get(name) ?? { name, service: serviceOfExecutable(name), sites: [] };
    p.sites.push(site);
    programs.set(name, p);
    if (p.service) add(p.service, { kind: "program", file: site.file, ...(site.line ? { line: site.line } : {}), ...(site.nodeId ? { nodeId: site.nodeId } : {}), detail: `runs ${name}`, via: name });
  };
  const unresolved: ServiceInventory["unresolved"] = [];
  for (const l of processLaunches(env as never)) {
    if (l.executable) ran(l.executable, { file: l.file, ...(l.line ? { line: l.line } : {}), nodeId: l.nodeId, from: l.from });
    else unresolved.push({ file: l.file, ...(l.line ? { line: l.line } : {}), expr: l.expr });
  }
  for (const [file, ir] of Object.entries(env.files)) {
    const lang = ir.language ?? "";
    const nodes = ir.nodes ?? [];
    if (lang === "bash") {
      for (const n of nodes) {
        const w = n.type === "call" ? n.funcName ?? "" : "";
        if (!w || BASH_BUILTINS.has(w) || RUNTIME_WORDS.has(w) || !(BASH_TOOLS[w] || EXECUTABLE_SERVICES[w])) continue;
        ran(w, { file, ...(n.line ? { line: n.line } : {}), nodeId: n.id, from: "command" });
      }
    }
    // hosts a request names
    if (lang === "python" || lang === "jsts") {
      for (const n of nodes) {
        if (n.effectKind !== "http") continue;
        const via = libraryOf(n.type === "call" ? n.funcName ?? "" : n.callTarget ?? "", file, lang, stack);
        for (const h of hostsOf(n, nodes)) {
          add(serviceOfHost(h.host) ?? h.host, { kind: "host", file, ...(n.line ? { line: n.line } : {}), nodeId: n.id, detail: `calls ${h.url}`, via });
        }
      }
    }
    // credentials
    for (const r of ir.envReads ?? []) {
      const svc = serviceOfKey(r.name);
      if (svc) add(svc, { kind: "credential", file, ...(r.line ? { line: r.line } : {}), detail: `reads ${r.name}`, via: r.name });
    }
  }

  // deploy files and workflows, each read whole (readManifest: the fact cap is the prompt's, not ours)
  const listed = infra?.files ?? (root ? readInfraManifests(root).files : []);
  for (const rel of listed) {
    const base = rel.split("/").pop() ?? rel;
    const platform = DEPLOY_FILES.find(([re]) => re.test(base))?.[1];
    const workflow = rel.startsWith(".github/workflows/");
    if (!platform && !workflow) continue;
    const facts = root ? readManifest(root, rel) : (infra?.facts ?? []).filter((f) => f.file === rel);
    if (platform) {
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
      const named = facts.filter((f) => f.kind === "deploy" && f.detail?.startsWith("main ")).map((f) => `${dir}${f.detail!.slice(5).replace(/^\.\//, "")}`);
      add(platform, { kind: "deploy", file: rel, line: 1, detail: named.length ? `${base} deploys ${named.join(", ")}` : `a ${base} deploy file`, via: base }, [rel, ...named]);
    }
    if (workflow) add("GitHub Actions", { kind: "workflow", file: rel, line: 1, detail: "a CI workflow", via: rel });
    for (const f of facts) {
      if (f.kind !== "step" || !f.detail) continue;
      for (const [re, svc] of WORKFLOW_SERVICES) if (re.test(f.detail)) add(svc, { kind: "workflow", file: f.file, line: f.line, detail: `${f.name}: ${f.detail}`, via: f.file });
    }
  }

  const sorted = [...services.values()].sort((a, b) => b.evidence.length - a.evidence.length || a.name.localeCompare(b.name));
  return { services: sorted, programs: [...programs.values()].sort((a, b) => a.name.localeCompare(b.name)), unresolved };
}

/** Every service name a label could claim: the inventory's, the programs it
 *  runs, and every name the tables know. */
function vocabulary(inv: ServiceInventory): string[] {
  const names = new Set<string>([
    ...inv.services.map((s) => s.name), ...inv.programs.map((p) => p.name),
    ...Object.values(EXECUTABLE_SERVICES), ...HOST_SERVICES.map(([, s]) => s), ...KEY_SERVICES.map(([, s]) => s),
    ...WORKFLOW_SERVICES.map(([, s]) => s),
  ]);
  return [...names].filter((n) => n.length >= 3);
}

export interface NodeLike { id: string; kind?: string; tool?: string; root?: string; entryPoints?: string[] }

/** The services and programs a node has evidence for: a tool node, those
 *  reached through it; a cluster, those whose evidence sits under its folder. */
export function servicesOfNode(node: NodeLike, inv: ServiceInventory): Set<string> {
  const out = new Set<string>();
  const t = node.tool ?? (node.id.startsWith("tool:") ? node.id.slice(5) : null);
  if (t) {
    for (const s of inv.services) if (s.via.includes(t)) out.add(s.name);
    if (inv.programs.some((p) => p.name === t)) out.add(t);
    return out;
  }
  const root = node.root === undefined ? null : node.root === "." || node.root === "" ? "" : `${node.root.replace(/\/$/, "")}/`;
  const files = (node.entryPoints ?? []).map((e) => e.split(":")[0]);
  const inside = (f: string) => (root !== null && f.startsWith(root)) || files.includes(f);
  for (const s of inv.services) if (s.files.some(inside) || s.evidence.some((e) => e.kind === "workflow")) out.add(s.name);
  for (const p of inv.programs) if (p.sites.some((x) => inside(x.file))) out.add(p.name);
  return out;
}

/** The services a label names that its node has no evidence for. */
export function servicesNamedWithout(label: string, node: NodeLike, inv: ServiceInventory): string[] {
  const have = servicesOfNode(node, inv);
  const said = vocabulary(inv).filter((n) => new RegExp(`(^|[^\\w.])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w])`, "i").test(label));
  return said.filter((n) => ![...have].some((h) => h.toLowerCase() === n.toLowerCase()) && n.toLowerCase() !== (node.tool ?? "").toLowerCase());
}
