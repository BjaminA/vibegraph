// M-XLANG.1 (PLAN-M-V5FORKS.md, PLAN-v5 §5.1) — CROSSINGS: where a thread
// leaves its own language over HTTP and which route, in another language,
// the request lands on.
//
// PLAN-v5 called this the HEAVY fork and priced it at "a JS/TS frontend
// parser + a per-file IR major bump". Both were paid by M-LANG3 and IR
// 2.0, and after M-BOUNDARY the caller's side is already a named fact: an
// `http` boundary with the URL expression in `args[0]`. The receiver's
// side has been structured since M8 — `entryPoints[].metadata.route`.
// So this module is only the JOIN, and it is a lookup over parsed data,
// never a regex over source text (which is what the M19 system tier's
// `_scan_calls_edges` does, and why it matches ZERO of the fleet
// example's four fetches).
//
// THE FLOOR, and the reason a crossing is not an edge: a thread's
// `filesReached` stays language-pure. A crossing carries `file: null`
// like every other terminal, so the three test floors that pin "a thread
// never crosses a language" keep passing AND keep meaning what they say —
// the thread's own files really are one language. What crosses is a
// weighed, labelled claim about where the request goes, and an ambiguous
// one stays ambiguous rather than picking a side.
//
// Pure: envelope in, crossings out. No fs, no spawn, no LLM.

import { languageForPath } from "../shared/languages.ts";
// Wire shapes live in protocol.ts (the webview renders the same record
// the server builds); re-exported here so server code has one import
// point - the stack.ts precedent.
import type { CrossingRecord, CrossingTargetRecord, CrossingIndexRecord } from "../shared/protocol.ts";
// M-FLOW.2 — the script-literal join, shared with scripts/discover_project.mjs
// (plain JS so a spawned discoverer and the server read ONE rule).
import { nodeCallee, nodeScriptRefs, quotedLiterals, resolveScriptFiles } from "../../scripts/frontends/script_refs.mjs";

/** A route this project serves, in any language. */
export interface RouteEntryLike {
  id: string;
  kind?: string;
  file?: string;
  irNodeId?: string;
  framework?: string | null;
  metadata?: { route?: unknown; method?: unknown; tool?: unknown; seed?: unknown } | null;
}

export interface CrossingEnvelopeLike {
  files: Record<string, { nodes?: any[]; language?: string }>;
  entryPoints?: RouteEntryLike[];
  threads?: Array<{ entryPointId?: string | null; filesReached?: string[]; nodes?: any[] }>;
}

export type CrossingTarget = CrossingTargetRecord;
export type Crossing = CrossingRecord;

export type CrossingIndex = CrossingIndexRecord;

// ── caller side: the URL expression → a static path shape ────────────

const INTERP = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\{[^}]*\}|<[^>]*>|:[A-Za-z_][A-Za-z0-9_]*$/;

/** Strip one layer of surrounding quotes or backticks. */
function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && /^["'`]/.test(t) && t[t.length - 1] === t[0]) return t.slice(1, -1);
  return t;
}

/**
 * The static path a URL expression yields, or null.
 *
 * Handles the four shapes the fixtures actually contain:
 *   `${API_BASE}/ingest`                        → /ingest
 *   `${API_BASE}/devices/${encodeURIComponent(id)}` → /devices/*
 *   `${API_BASE}/export?since=${since}`         → /export
 *   "http://$host/health"                       → /health
 * A URL with no static path at all (a bare variable) yields null — the
 * honest answer, and the reason `requests.Session()` produces no crossing.
 */
export function urlPath(expr: string): string | null {
  let s = unquote(expr);
  if (!s) return null;
  // Drop scheme + host when the URL is absolute (bash `"http://$host/x"`).
  const scheme = s.indexOf("://");
  if (scheme !== -1) {
    const rest = s.slice(scheme + 3);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    s = rest.slice(slash);
  } else if (!s.startsWith("/")) {
    // A leading interpolation is a base-URL variable: keep the remainder.
    const slash = s.indexOf("/");
    if (slash <= 0) return null;
    const head = s.slice(0, slash);
    // ...but only when the head really is ONE interpolation, not a word.
    // `users/1` must not become `/1`.
    if (!/^(\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\{[^}]*\})$/.test(head)) return null;
    s = s.slice(slash);
  }
  // Cut the query and the fragment: they are not part of the route.
  s = s.split("?")[0].split("#")[0];
  if (!s.startsWith("/")) return null;
  // Any interpolated segment becomes `*` — the shape is what matches.
  const segs = s.split("/").map((seg) => (seg && INTERP.test(seg) ? "*" : seg));
  const path = segs.join("/");
  return path === "" ? "/" : path.replace(/\/+$/, "") || "/";
}

/** Verbs a callee name states outright (`requests.post`, `session.get`). */
const CALLEE_VERB = /\.(get|post|put|delete|patch|head|options)$/i;
/** Callers whose documented default is GET when nothing says otherwise. */
const DEFAULT_GET = new Set(["fetch", "curl", "wget", "requests.request"]);

/** The caller's HTTP method, and whether it is a default rather than a
 *  parsed fact. `null` when nothing in reach says. */
export function callerMethod(callee: string, args: string[]): { method: string | null; assumed: boolean } {
  const verb = CALLEE_VERB.exec(callee);
  if (verb) return { method: verb[1].toUpperCase(), assumed: false };
  const blob = args.join(" ");
  // fetch's options object, and curl's -X / --request.
  const opt = /\bmethod\s*[:=]\s*["'`]?([A-Za-z]+)/.exec(blob)
    ?? /(?:-X|--request)\s+["'`]?([A-Za-z]+)/.exec(blob);
  if (opt) return { method: opt[1].toUpperCase(), assumed: false };
  const head = callee.split("(")[0];
  if (DEFAULT_GET.has(head)) return { method: "GET", assumed: true };
  return { method: null, assumed: false };
}

// ── receiver side: a route's shape ───────────────────────────────────

/** Flask `<device_id>` / `<int:uid>`, express `:id`, others `{id}` — all
 *  are ONE parameter segment, and all match an interpolated caller
 *  segment. Ported from the system tier's `_route_prefix`, which already
 *  knew all three syntaxes. */
function isParamSegment(seg: string): boolean {
  return /^[<{:]/.test(seg) || seg === "*";
}

/**
 * Do a caller path and a route path describe the same endpoint?
 *
 * SHAPE, not prefix: the segment counts must agree, and each segment must
 * be literally equal or a parameter on at least one side. This is what
 * keeps `/devices` and `/devices/<device_id>` apart — the discriminating
 * pair the fleet example provides, and one a longest-prefix matcher gets
 * wrong.
 */
export function pathMatchesRoute(callerPath: string, route: string): boolean {
  const a = callerPath.split("/").filter((x, i) => i > 0 || x !== "");
  const b = route.split("/").filter((x, i) => i > 0 || x !== "");
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (isParamSegment(a[i]) || isParamSegment(b[i])) continue;
    return false;
  }
  return true;
}

/** A route's method, and whether it is the framework's default rather
 *  than a parsed `methods=`. Flask's bare `@app.route` is implicit GET;
 *  `discover_entry_points.py` never materialises it, so it is stated as
 *  an assumption here instead of being invented there. */
function routeMethod(ep: RouteEntryLike): { method: string; assumed: boolean } {
  const m = ep.metadata?.method;
  if (typeof m === "string" && m) return { method: m.toUpperCase(), assumed: false };
  if (Array.isArray(m) && m.length) return { method: String(m[0]).toUpperCase(), assumed: false };
  return { method: "GET", assumed: true };
}

// ── the join ─────────────────────────────────────────────────────────

const HTTP_EFFECT = "http";

interface CallSite {
  file: string;
  nodeId: string;
  callee: string;
  args: string[];
}

/** Every http-effect call in one file, with its URL arguments. */
function httpCalls(file: string, nodes: any[]): CallSite[] {
  const out: CallSite[] = [];
  for (const n of nodes) {
    if (n?.effectKind !== HTTP_EFFECT) continue;
    const callee = typeof n.callTarget === "string" ? n.callTarget
      : typeof n.funcName === "string" ? n.funcName : "";
    if (!callee) continue;
    const args = Array.isArray(n.args) ? n.args.filter((a: unknown): a is string => typeof a === "string") : [];
    if (typeof n.id !== "string") continue;
    out.push({ file, nodeId: n.id, callee, args });
  }
  return out;
}

/**
 * Build the crossing index.
 *
 * Per THREAD, because two of the rules need the thread's own reach:
 *  * a crossing is attached to the thread whose walk contains the call;
 *  * SAME-SERVICE EXCLUSION — a route whose handler lives in a file this
 *    thread already walks is this service talking to itself, not a
 *    crossing. That single rule resolves three of the fleet example's
 *    four cases to exactly one target (the gateway serves `/ingest`,
 *    `/export` and `/devices/:id` itself while calling the Python service
 *    for all three), and it leaves the fourth — a shell script curling
 *    `/health`, which both services serve — honestly ambiguous.
 */
// ── M-FLOW.2 — the `command` and `tool` kinds ────────────────────────────
//
// The HTTP join above is one instance of a shape: the CALLER names its target
// by a literal, the CALLEE declares that literal as its identity. A browser
// hook handing "accounts/get_accounts_financials.sh" to a Volt CommandStream
// and a shell script handing "${DIR}/lib/rates.mjs" to node are the same
// join over a file path; `callTool({ name: "list_orders" })` against
// `registerTool("list_orders", …)` is the same join over a tool name. On the
// codebase this was built for, the flow its own architecture doc calls the
// architecture was fully parsed and none of it was a thread: two of its three
// process boundaries are joined this way, not over HTTP.

/** The entry a `command` crossing lands on. A file may carry several (a
 *  discovered main/module beside a manual seed); the one that represents
 *  the FILE running wins. */
function fileEntry(entries: RouteEntryLike[]): RouteEntryLike | null {
  if (!entries.length) return null;
  const rank = (e: RouteEntryLike) => e.irNodeId === "module" ? 0 : /:main$/.test(e.id) ? 1 : e.kind === "cli" ? 2 : 3;
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
}

/** Per node, the top-level function it sits in (null = module level). */
function scopeOf(nodes: any[]): Map<string, string | null> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, string | null>();
  const top = (n: any): string | null => {
    if (memo.has(n.id)) return memo.get(n.id)!;
    let cur = n;
    let fn: string | null = null;
    while (cur) {
      if ((cur.type === "function_def" || cur.type === "class_def") && cur.id !== n.id) fn = cur.id;
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    memo.set(n.id, fn);
    return fn;
  };
  for (const n of nodes) top(n);
  return memo;
}

function commandCrossings(
  env: CrossingEnvelopeLike, ep: string, th: { nodes?: any[] }, reached: string[],
  entriesByFile: Map<string, RouteEntryLike[]>,
): Crossing[] {
  const out: Crossing[] = [];
  const fileKeys = Object.keys(env.files);
  // The functions this thread EXECUTES per file (its seed and steps), so a
  // literal counts when it sits in one of their bodies or at module level of
  // a file the thread reached — a constant the file defines is in scope for
  // every function in it (bash's `MJS_SCRIPT="${DIR}/ingest.mjs"` above main).
  const walked = new Map<string, Set<string>>();
  for (const n of th.nodes ?? []) {
    if ((n.kind === "seed" || n.kind === "step") && typeof n.file === "string" && typeof n.irNodeId === "string") {
      if (!walked.has(n.file)) walked.set(n.file, new Set());
      walked.get(n.file)!.add(n.irNodeId);
    }
  }
  const seenSuffix = new Set<string>();
  for (const file of reached) {
    const nodes = env.files[file]?.nodes ?? [];
    const scope = scopeOf(nodes);
    const fns = walked.get(file) ?? new Set<string>();
    for (const n of nodes) {
      if (!n || typeof n.id !== "string") continue;
      const sc = scope.get(n.id) ?? null;
      // M-FLOW.5 — a function_def's own literals (parameter defaults) count
      // when THAT function is a step; a module-level definition nobody on
      // this thread calls is not "module level".
      const inWalkedFn = n.type === "function_def" ? fns.has(n.id) : (sc !== null && fns.has(sc));
      const moduleLevel = sc === null && n.type !== "function_def";
      if (!inWalkedFn && !moduleLevel) continue;
      // A dynamic `import("./x.js")` or `require("./x")` LOADS a module; that
      // is the linker's business (or a named resolution gap), not a script
      // run — 57 of the first real run's hops were these.
      const callee = nodeCallee(n);
      if (/(^|\.)(import|require)$/.test(callee)) continue;
      for (const { literal, suffix, scriptShaped } of nodeScriptRefs(n)) {
        const { files: all, matched } = resolveScriptFiles(fileKeys, suffix);
        // A file the thread already walked is a resolved call, not a hop; a
        // file naming itself is not a crossing either.
        if (all.length && all.every((f) => f === file || reached.includes(f))) continue;
        // A path that is not script-shaped (a .csv, a data directory) is a
        // hop only when a parsed file answers to it; unmatched, it is data.
        if (!all.length && !scriptShaped) continue;
        // One literal on one line is ONE hop: a nested call and the call
        // that wraps it (`connect(new Transport({ args: ["x.js"] }))`) both
        // carry the text, and the extractor minted both.
        const key = `${file}|${suffix}|${typeof n.line === "number" ? n.line : n.id}`;
        if (seenSuffix.has(key)) continue;
        seenSuffix.add(key);
        const candidates = all.filter((f) => f !== file && !reached.includes(f));
        const targets: CrossingTarget[] = [];
        const notes: string[] = [];
        for (const f of candidates) {
          const e = fileEntry(entriesByFile.get(f) ?? []);
          if (e) targets.push({ entryPointId: e.id, route: f, method: "command", ...(e.framework ? { framework: e.framework } : {}) });
          else notes.push(`${f} is parsed but has no entry point — nothing marks it executable (no shebang, no main; a manual seed on "module" would)`);
        }
        const confidence: Crossing["confidence"] = targets.length === 0 ? "unmatched" : targets.length > 1 ? "ambiguous" : "path";
        if (!all.length) notes.push("no parsed file's path ends with that literal — a script outside the parsed tree, a typo, or a path assembled at runtime");
        if (targets.length > 1) notes.push(`${targets.length} parsed files end with that path and nothing here separates them — all are named, none is claimed`);
        if (matched !== suffix) notes.push(`the literal is a deploy path; the tail it shares with a parsed file (\`${matched}\`) is the match`);
        notes.push(`named by a string literal in ${nodeCallee(n)}${!inWalkedFn ? " (module level of a file this thread reaches)" : ""}; the command that carries it (a platform CommandStream, exec, child_process) is attributed on the boundary node, not here`);
        out.push({
          kind: "command", entryPointId: ep, file, nodeId: n.id, callee: nodeCallee(n),
          path: literal, method: null, targets, confidence, note: notes.join("; "),
        });
      }
    }
  }
  return out;
}

const TOOL_CALLEE = /(^|\.)callTool$/;

/** `callTool("x")` → x; `callTool({ name: "x", arguments })` → x; else null. */
export function toolNameOf(n: any): string | null {
  const callee = nodeCallee(n);
  if (!TOOL_CALLEE.test(callee)) return null;
  const a0 = Array.isArray(n.args) ? n.args[0] : undefined;
  if (typeof a0 !== "string") return null;
  const m = /\bname\s*:\s*(["'`])([^"'`]+)\1/.exec(a0);
  if (m) return m[2];
  const q = quotedLiterals(a0);
  return q.length ? q[0] : null;
}

function toolCrossings(
  env: CrossingEnvelopeLike, ep: string, reached: string[], reachedNodeIds: Set<string>,
  toolEntries: RouteEntryLike[],
): Crossing[] {
  const out: Crossing[] = [];
  for (const file of reached) {
    for (const n of env.files[file]?.nodes ?? []) {
      if (!n || typeof n.id !== "string" || (reachedNodeIds.size && !reachedNodeIds.has(n.id))) continue;
      const name = toolNameOf(n);
      if (!name) continue;
      const targets: CrossingTarget[] = toolEntries
        .filter((e) => e.metadata?.tool === name)
        .map((e) => ({ entryPointId: e.id, route: name, method: "tool", ...(e.framework ? { framework: e.framework } : {}) }));
      const confidence: Crossing["confidence"] = targets.length === 0 ? "unmatched" : targets.length > 1 ? "ambiguous" : "path";
      const notes: string[] = [];
      if (!targets.length) notes.push("no tool is registered under that name in this project — the server may be a package or another repository");
      if (targets.length > 1) notes.push(`${targets.length} registrations carry that name and nothing here separates them`);
      notes.push("the server this client connects to is not resolved (a transport names it by command or URL at runtime); the match is on the tool name alone");
      out.push({
        kind: "tool", entryPointId: ep, file, nodeId: n.id, callee: nodeCallee(n),
        path: name, method: null, targets, confidence, note: notes.join("; "),
      });
    }
  }
  return out;
}

export function buildCrossingIndex(env: CrossingEnvelopeLike): CrossingIndex {
  const routes = (env.entryPoints ?? []).filter(
    (e) => e.kind === "route" && typeof e.metadata?.route === "string" && (e.metadata!.route as string).startsWith("/"),
  );
  // M-FLOW.2 — the callee sides of the two new kinds.
  const entriesByFile = new Map<string, RouteEntryLike[]>();
  for (const e of env.entryPoints ?? []) {
    if (!e.file) continue;
    if (!entriesByFile.has(e.file)) entriesByFile.set(e.file, []);
    entriesByFile.get(e.file)!.push(e);
  }
  const toolEntries = (env.entryPoints ?? []).filter((e) => typeof e.metadata?.tool === "string");
  const callsByFile = new Map<string, CallSite[]>();
  for (const [file, ir] of Object.entries(env.files)) {
    const calls = httpCalls(file, ir.nodes ?? []);
    if (calls.length) callsByFile.set(file, calls);
  }

  const all: Crossing[] = [];
  const byThread: Record<string, Crossing[]> = {};
  for (const th of env.threads ?? []) {
    const ep = th.entryPointId;
    if (!ep) continue;
    const reached = th.filesReached ?? [];
    // Only the calls this thread's walk actually contains. A file can hold
    // several; the thread's own nodes say which ones it reached.
    const reachedNodeIds = new Set(
      (th.nodes ?? []).map((n: any) => (typeof n?.irNodeId === "string" ? n.irNodeId : null)).filter(Boolean) as string[],
    );
    const found: Crossing[] = [];
    for (const file of reached) {
      for (const call of callsByFile.get(file) ?? []) {
        if (reachedNodeIds.size && !reachedNodeIds.has(call.nodeId)) continue;
        const path = call.args.map(urlPath).find((p): p is string => !!p) ?? null;
        if (!path) continue;
        const { method, assumed } = callerMethod(call.callee, call.args);
        const notes: string[] = [];

        let candidates = routes.filter((r) => pathMatchesRoute(path, r.metadata!.route as string));
        // Same-service exclusion, stated when it fires.
        const selfServed = candidates.filter((r) => r.file && reached.includes(r.file));
        if (selfServed.length) {
          candidates = candidates.filter((r) => !selfServed.includes(r));
          notes.push(`${selfServed.map((r) => r.id).join(", ")} ${selfServed.length > 1 ? "serve" : "serves"} this path but ${selfServed.length > 1 ? "are" : "is"} inside this thread's own files — a service calling itself is not a crossing`);
        }
        // Method, when both sides have one to compare.
        const withMethod = candidates.map((r) => ({ r, m: routeMethod(r) }));
        const methodMatched = method ? withMethod.filter((x) => x.m.method === method) : withMethod;
        const finalists = methodMatched.length ? methodMatched : withMethod;

        const targets: CrossingTarget[] = finalists.map(({ r, m }) => ({
          entryPointId: r.id,
          route: r.metadata!.route as string,
          method: m.method,
          ...(r.framework ? { framework: r.framework } : {}),
          ...(m.assumed ? { methodAssumed: true as const } : {}),
        }));

        // `path+method` is earned only when BOTH sides PARSED a method. Two
        // framework defaults agreeing is two assumptions agreeing, and
        // calling that a method match would dress a guess as evidence.
        const bothMethodsParsed = !!method && !assumed
          && targets.length === 1 && !targets[0].methodAssumed;
        const confidence: Crossing["confidence"] = targets.length === 0
          ? "unmatched"
          : targets.length > 1 ? "ambiguous"
            : bothMethodsParsed ? "path+method" : "path";

        if (!targets.length) notes.push("no route in this project serves that path");
        if (targets.length > 1) notes.push(`${targets.length} routes serve this path and nothing here separates them — both are named, neither is claimed`);
        if (assumed && method) notes.push(`the caller states no method; ${call.callee} defaults to ${method}`);
        for (const t of targets) {
          if (t.methodAssumed) notes.push(`${t.entryPointId} declares no methods, so its framework's default (${t.method}) is assumed`);
        }
        // The base URL is never resolved: `${API_BASE}` is one assignment
        // hop away and this module does not follow it.
        notes.push("the request's base URL is not resolved, so the match is on path shape alone");

        found.push({
          kind: "http", entryPointId: ep, file, nodeId: call.nodeId, callee: call.callee,
          path, method, ...(assumed && method ? { methodAssumed: true as const } : {}),
          targets, confidence, note: notes.join("; "),
        });
      }
    }
    // M-FLOW.2 — the hops that are not HTTP.
    found.push(...commandCrossings(env, ep, th, reached, entriesByFile));
    found.push(...toolCrossings(env, ep, reached, reachedNodeIds, toolEntries));
    if (found.length) {
      byThread[ep] = found;
      all.push(...found);
    }
  }
  return { all, byThread };
}

/** The languages a crossing joins, for a render that wants to say so. */
export function crossingLanguages(c: Crossing, routeFileOf: (epId: string) => string | null): { from: string; to: string[] } {
  const from = languageForPath(c.file)?.id ?? "unknown";
  const to = [...new Set(c.targets.map((t) => {
    const f = routeFileOf(t.entryPointId);
    return (f ? languageForPath(f)?.id : null) ?? "unknown";
  }))];
  return { from, to };
}
