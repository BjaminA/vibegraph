/**
 * M7 wave 1 — MCP Streamable-HTTP server mounted on the same Node http.Server
 * as the WebSocket runtime in server.ts.
 *
 * Sessions are stateful: the first POST (an `initialize` request) gets a fresh
 * StreamableHTTPServerTransport with a new UUID session id; subsequent
 * requests reuse it via the `mcp-session-id` header. SSE streams for
 * server→client notifications hang off the same session.
 *
 * Registration from a Claude Code terminal:
 *   claude mcp add vibegraph --transport http http://localhost:4200/mcp
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { VibegraphMcpContext, RewriteOp } from "./context.js";
// M-NEST L3 — the agent-facing thread projection. Pure logic (no DOM/React),
// shared with the webview so `projection == collapse(full)` holds by construction.
import { projectThreadForAgent, drillThread } from "../webview/threads/collapse.js";
import type { Thread } from "../webview/threads/types.js";

interface ConnectedSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  unsubscribe: () => void;
}

// Resource URIs are exported so server.ts can target them in
// sendResourceUpdated notifications when project state changes.
export const VIBEGRAPH_RESOURCE_PROJECT_IR = "vibegraph://project/ir";
export const VIBEGRAPH_RESOURCE_SELECTION = "vibegraph://selection";
export const VIBEGRAPH_RESOURCE_SHAPE_GRAMMAR = "vibegraph://shape-grammar";
// M20.1 — dynamic-README resource templates (PLAN-v5 §2.3). Pull-on-demand,
// never auto-injected: the agent reads these when it wants the compact
// summary instead of re-reading every file a thread touches.
export const VIBEGRAPH_RESOURCE_THREAD_README = "vibegraph://thread/{id}/readme";
export const VIBEGRAPH_RESOURCE_FILE_README = "vibegraph://files/{path}/readme";

const REWRITE_OPS: RewriteOp[] = [
  "replace_node",
  "insert_statement_before",
  "insert_statement_after",
  "delete_node",
  "rename_symbol",
];

/**
 * A refused edit must read as authoritative and actionable, never as a
 * dead end to route around.
 *
 * The bare `Rewrite rejected: <error>` this replaced did the opposite:
 * facing it, the chat's Claude reached for its own file-write tools and
 * finished the task outside the CST chokepoint entirely — the edit landed
 * with none of the structural verification the architecture promises
 * (reviews/modify-showdown-2026-08/). Raw write tools are now denied to
 * the chat child, so spelling out the sanctioned routes is what keeps a
 * refusal from becoming a dead end.
 *
 * Formatting noise is no longer a reason to be here: the rewriter retries
 * unformatted before refusing, so reaching this text means the edit
 * genuinely changes code outside the target node.
 */
function refusalText(what: string, message?: string, errorKind?: string): string {
  const head = `${what} rejected: ${message ?? "unknown error"}`;
  const preamble = [
    "",
    "This refusal is authoritative and the file is unchanged. Do NOT edit the",
    "file directly — writes reach disk only through the VibeGraph edit tools,",
    "and bypassing them would skip the structural verification this refusal is",
    "part of.",
  ];
  // Guidance must match the ACTUAL failure. An earlier version appended the
  // confinement advice to every rejection, so a syntax error was reported as
  // "the edit changes code OUTSIDE the node you targeted" — which sent the
  // caller re-targeting nodes to fix a typo.
  const advice: Record<string, string[]> = {
    parse_error: [
      "Your source is not valid Python on its own, so nothing was applied.",
      "Send the statements only — a method body does not need its class",
      "indentation, and a partial expression will not parse. Fix the syntax",
      "and retry the same node.",
    ],
    diff_confinement_failed: [
      "The edit changes code OUTSIDE the node you targeted, so either:",
      "  - re-target a node whose span actually covers the change (e.g. the",
      "    enclosing function or the module) and retry; or",
      "  - keep the edit inside the target node; or",
      "  - report the refusal to the user with what it would have touched.",
    ],
    target_not_found: [
      "That node id does not exist in this file. Call vibegraph_get_node_source",
      'with nodeId "module" to read the whole file, or vibegraph_find_symbol to',
      "locate the right id, then retry.",
    ],
    wrong_node_kind: [
      "The node you targeted is not the kind this operation edits. Re-target a",
      "node of the right kind (the error above names what was expected).",
    ],
    unused_import: [
      "A hoisted import is not referenced in the body. Remove it or use it.",
    ],
    empty_source: [
      "The payload was empty. Use delete_node to remove a node — an empty",
      "source is never treated as an implicit delete.",
    ],
  };
  const tail = (errorKind && advice[errorKind]) ?? [
    "Fix the cause named above and retry, or report the refusal to the user.",
  ];
  return [head, ...preamble, "", ...tail].join("\n");
}

function registerTools(server: McpServer, ctx: VibegraphMcpContext): void {
  server.registerTool(
    "vibegraph_list_files",
    {
      description:
        "List every .py file in the loaded project (or just the single launched file). " +
        "Use this first to discover what files are available before calling get_project_ir " +
        "or get_node_source with a specific filePath.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(ctx.listFiles(), null, 2) }],
    }),
  );

  server.registerTool(
    "vibegraph_get_project_ir",
    {
      description:
        "Return the parsed IR for one file or the whole project. " +
        "Pass filePath to get that file's per-file IR ({ nodes, edges, symbolIndex }, schema v1.1). " +
        "Omit filePath in directory mode to get the project envelope " +
        "({ version: '2.0', files, symbolIndex, entryPoints, threads }, schema v2.0 — see " +
        "schemas/project_ir.schema.json). entryPoints and threads are empty until M8.2/M8.3 fill them. " +
        "Single-file mode returns the lastParse regardless of filePath.",
      inputSchema: {
        filePath: z.string().optional().describe("Path relative to the project root (as returned by list_files)."),
      },
    },
    async ({ filePath }) => ({
      content: [{ type: "text", text: JSON.stringify(ctx.getProjectIR(filePath), null, 2) }],
    }),
  );

  server.registerTool(
    "vibegraph_list_entry_points",
    {
      description:
        "List the project's discovered thread entry points (PLAN-v2.md §1.2). " +
        "Each entry has { id, kind, file, irNodeId, qualifiedName, label, framework, summary?, metadata? }. " +
        "Kinds: cli (argparse/click/typer or `if __name__ == \"__main__\":`), route (Flask/FastAPI " +
        "decorator-name match), public_api (function/class targeted by a cross-file `reference` edge), " +
        "test (def test_* in test_*.py), manual (loaded from .vibegraph/manual_seeds.json). " +
        "Use the `id` to seed vibegraph_extract_thread, or `irNodeId`+`file` to drive vibegraph_set_selection. " +
        "Single-file mode returns an empty array.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(ctx.listEntryPoints(), null, 2) }],
    }),
  );

  server.registerTool(
    "vibegraph_generate_readme",
    {
      description:
        "Generate (or refresh) a dynamic README — a compact context anchor — for a thread or a file, " +
        "via `claude -p`, then persist it under .vibegraph/readmes/ stamped with the current IR hash. " +
        "scope='thread' + id=an entryPoints[].id, or scope='file' + id=a project-relative path. " +
        "Read it back (with a staleness flag) from vibegraph://thread/{id}/readme or " +
        "vibegraph://files/{path}/readme. On-request only — nothing regenerates on save.",
      inputSchema: {
        scope: z.enum(["thread", "file"]).describe("thread (id=entryPointId) or file (id=relative path)."),
        id: z.string().describe("entryPoints[].id for a thread, or the project-relative file path."),
      },
    },
    async ({ scope, id }) => ({
      content: [{ type: "text", text: JSON.stringify(await ctx.generateReadme(scope, id), null, 2) }],
    }),
  );

  server.registerTool(
    "vibegraph_get_node_source",
    {
      description:
        "Return the source slice that a structural-path node id covers. Use this when you need to see " +
        "the actual code for a node before suggesting an edit. Structural-path ids look like " +
        "'module/Shape.class/area.fn/return@0' and are stable across whitespace edits.",
      inputSchema: {
        nodeId: z.string().describe("Structural-path id."),
        filePath: z.string().optional().describe("Project-mode: which file the node belongs to."),
      },
    },
    async ({ nodeId, filePath }) => {
      const r = ctx.getNodeSource(nodeId, filePath);
      if ("error" in r) {
        return { content: [{ type: "text", text: `Error: ${r.error}` }], isError: true };
      }
      return { content: [{ type: "text", text: r.source }] };
    },
  );

  server.registerTool(
    "vibegraph_find_symbol",
    {
      description:
        "Search every file's symbolIndex for entries whose name matches. Optionally filter by kind " +
        "(function, class, assignment, etc.). Returns full symbolIndex entries with file path, " +
        "structural-path id, signature where applicable.",
      inputSchema: {
        name: z.string().describe("Symbol name to search for (exact match)."),
        kind: z.string().optional().describe("Restrict to a specific kind from the IR schema."),
      },
    },
    async ({ name, kind }) => ({
      content: [{ type: "text", text: JSON.stringify(ctx.findSymbol(name, kind), null, 2) }],
    }),
  );

  server.registerTool(
    "vibegraph_set_selection",
    {
      description:
        "Drive the webview's selection from outside. Highlights the node in diagram, code, and " +
        "thread views simultaneously (via the M5 vg-selection bus). Webview will scroll the code " +
        "view to the node. Read the current selection via the vibegraph://selection resource.",
      inputSchema: {
        nodeId: z.string().describe("Structural-path id to select."),
        filePath: z.string().optional().describe("Project-mode: file the node lives in."),
      },
    },
    async ({ nodeId, filePath }) => {
      ctx.setSelection(nodeId, filePath);
      return { content: [{ type: "text", text: `Selected ${nodeId}` }] };
    },
  );

  server.registerTool(
    "vibegraph_rewrite_node",
    {
      description:
        "Apply a CST-backed rewrite. The op must be one of: replace_node, insert_statement_before, " +
        "insert_statement_after, delete_node, rename_symbol. payload shape depends on op: " +
        "replace_node + insert_*: { source } (non-empty; to remove a node use delete_node, an empty " +
        "source is rejected); delete_node: {}; rename_symbol: { newName }. filePath may be " +
        "project-relative (as returned by vibegraph_list_files) or absolute. " +
        "The rewrite goes through black + a diff check; if the diff exceeds the targeted node's span " +
        "the edit is rejected. After a successful edit the file is re-parsed and broadcast to the webview.",
      inputSchema: {
        nodeId: z.string(),
        op: z.enum(REWRITE_OPS as [RewriteOp, ...RewriteOp[]]),
        payload: z.record(z.string(), z.unknown()).default({}),
        filePath: z.string().optional(),
      },
    },
    async ({ nodeId, op, payload, filePath }) => {
      const r = await ctx.rewriteNode({ nodeId, op, payload: payload ?? {}, filePath });
      if (!r.success) {
        return {
          content: [{ type: "text", text: refusalText("Rewrite", r.message, r.errorKind) }],
          isError: true,
        };
      }
      // B3 — the structural IR delta rides the edit response so the agent can
      // self-verify the change moved what it intended.
      const delta = r.delta ? `\nStructural delta: ${JSON.stringify(r.delta.summary)}\n${JSON.stringify(r.delta, null, 2)}` : "";
      return { content: [{ type: "text", text: `Rewrote ${nodeId} (${op})${delta}` }] };
    },
  );

  server.registerTool(
    "vibegraph_compose_insert",
    {
      description:
        "Insert a fresh block of code via the compose pipeline. mode='before' or 'after' inserts " +
        "adjacent to an anchorNodeId; mode='top-level' appends to the file. source is the Python " +
        "code to insert (will be formatted by black). filePath may be project-relative (as " +
        "returned by vibegraph_list_files) or absolute. The insertion is validated by re-parsing " +
        "before commit.",
      inputSchema: {
        mode: z.enum(["before", "after", "top-level"]),
        source: z.string(),
        anchorNodeId: z.string().optional(),
        filePath: z.string().optional(),
      },
    },
    async (args) => {
      const r = await ctx.composeInsert(args);
      if (!r.success) {
        return {
          content: [{ type: "text", text: refusalText("Compose-insert", (r as any).message, (r as any).errorKind) }],
          isError: true,
        };
      }
      const delta = r.delta ? `\nStructural delta: ${JSON.stringify(r.delta.summary)}\n${JSON.stringify(r.delta, null, 2)}` : "";
      return { content: [{ type: "text", text: `Inserted (mode=${args.mode})${delta}` }] };
    },
  );

  server.registerTool(
    "vibegraph_create_file",
    {
      description:
        "M-ORCH.3 — create a NEW Python module through the CST chokepoint (cst_rewrite create_file: " +
        "parse-gated, black-formatted). Allowed ONLY while a work-run packet is RUNNING and the path is " +
        "among that packet's files — a SYSTEM packet the orchestrator proposed and the human confirmed " +
        "at the objective gate. Refuses existing files (edit those with vibegraph_rewrite_node / " +
        "vibegraph_compose_insert), non-Python paths (v1 limit), and paths outside the project. On " +
        "success the file is parsed, linked, and derived data refreshes — it appears in the IR like any " +
        "other module. If the work needs a file not in your packet, escalate; do not route around this.",
      inputSchema: {
        path: z.string().describe("Project-relative path of the NEW .py file (e.g. telemetry/migrations.py)."),
        source: z.string().describe("The complete module source."),
      },
    },
    async ({ path, source }) => {
      const r = await ctx.createFile(path, source);
      if (!r.ok) return { content: [{ type: "text", text: `Create-file refused: ${r.message}` }], isError: true };
      return { content: [{ type: "text", text: r.message }] };
    },
  );

  server.registerTool(
    "vibegraph_extract_thread",
    {
      description:
        "Trace a static logic thread forward from a seed function. Stops at site-packages calls, " +
        "dynamic attribute access, unresolved callees, or non-trivial branches. " +
        "By DEFAULT returns a COMPACT projection: nested call-arg calls are collapsed, and each step " +
        "is honestly marked with one of two DISTINCT states — `nestedCollapsed: N` (N nested calls " +
        "ARE in the IR; drill to expand them) or `uncaptured: true` (the statement hides calls v1 did " +
        "NOT decompose — chains/comprehensions/literals — they are NOT in the IR and cannot be drilled; " +
        "the path is genuinely incomplete here). Never read an uncaptured step as empty-or-complete. " +
        "Pass expandNests=true for the FULL thread, or drillNest=<stepId> for one nest's full sub-IR.",
      inputSchema: {
        seedNodeId: z.string().describe("Structural-path id of the seed function."),
        filePath: z.string().optional(),
        expandNests: z.boolean().optional()
          .describe("Return the FULL thread incl. every nested call node (no collapse)."),
        drillNest: z.string().optional()
          .describe("Expand only the nest rooted at this step's node id, returning its full sub-IR."),
      },
    },
    async ({ seedNodeId, filePath, expandNests, drillNest }) => {
      const r = await ctx.extractThread(seedNodeId, filePath);
      // Project only when we actually got a thread (extractThread may surface
      // an error object); otherwise pass through untouched.
      const out =
        r && typeof r === "object" && Array.isArray((r as { nodes?: unknown }).nodes)
          ? drillNest
            ? drillThread(r as Thread, drillNest)
            : expandNests
              ? drillThread(r as Thread) // whole thread, fully expanded
              : projectThreadForAgent(r as Thread) // compact default
          : r;
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_observe_dynamic_target",
    {
      description:
        "Runtime-assisted resolution of a DYNAMIC dispatch: run the enclosing function up to a dynamic " +
        "call site and observe the receiver's runtime type — the actual dispatch target for THIS run. " +
        "nodeId is the dynamic call-site node; receiver is the variable whose type to inspect (e.g. 'conn' " +
        "for conn.execute, from the dynamic node's label). Returns { observedTarget, note, outcome }. " +
        "CRITICAL: observedTarget is a RUNTIME SAMPLE (this run, these inputs) — NEVER a static fact. One " +
        "run can lie; the node stays dynamic and the IR is unchanged. Same SM3 effect floor + consent as " +
        "run_thread_to_node: observing requires the receiver's binding code to run, so an effectful " +
        "binding returns requires-confirmation + a token. observedTarget is null on any non-ok outcome. " +
        "An enclosing function that requires arguments declines needs-inputs before anything runs (Observe " +
        "never synthesizes inputs — use vibegraph_run_thread_to_node with synthArgs, or observe from a caller); " +
        "a run that raises carries the exception line in `error`.",
      inputSchema: {
        nodeId: z.string().describe("The dynamic call-site node id."),
        receiver: z.string().describe("The receiver variable whose runtime type to observe (e.g. conn)."),
        filePath: z.string().optional().describe("Project-mode: file the node lives in."),
        effectConsent: z.string().optional().describe("Token from a prior requires-confirmation, to authorise an effectful run."),
      },
    },
    async ({ nodeId, receiver, filePath, effectConsent }) => {
      const r = await ctx.observeDynamicTarget({ nodeId, receiver, filePath, effectConsent });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_trace_thread",
    {
      description:
        "Run ONE entry point under a profiler and record what every call site it touched ACTUALLY " +
        "called — the batch form of vibegraph_observe_dynamic_target. Use it when a thread has several " +
        "dynamic/unresolved dispatches and you want them all resolved from a single run rather than " +
        "one at a time. Returns { outcome, observed, run } where `observed` is how many IR nodes were " +
        "annotated. CRITICAL: every observation is a RUNTIME SAMPLE (this run, these inputs) — NEVER a " +
        "static fact. One run can lie: a branch that did not execute is not reported, and a different " +
        "input may dispatch elsewhere. Nodes keep their dynamic/unresolved kind; the overlay is stored " +
        "beside the IR in .vibegraph/observations.json, never merged into it. Same SM3 effect floor as " +
        "run_thread_to_node: a trace runs the WHOLE entry point, so an effectful path returns " +
        "requires-confirmation + a token and nothing has run until you re-call with it. Only entry " +
        "points that take NO arguments can be traced — inventing inputs is the synth chokepoint's job, " +
        "under its own consent, not a tracer's.",
      inputSchema: {
        entryPointId: z.string().describe("The entry point to run (e.g. calc.py:dispatch)."),
        effectConsent: z.string().optional().describe("Token from a prior requires-confirmation, to authorise an effectful run."),
      },
    },
    async ({ entryPointId, effectConsent }) => {
      const r = await ctx.traceEntryPoint({ entryPointId, effectConsent });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_spawn_thread_agent",
    {
      description:
        "Spawn a subagent whose context is DELIBERATELY BOUNDED to one thread (entryPointId): its compact " +
        "execution projection, its human-ratified thread-skill (if any), its blind-spot roll-up (what is " +
        "NOT statically known), and the adjacent threads it reaches / is reached by. The agent is told to " +
        "ESCALATE — return a line starting 'ESCALATE:' — when the task needs context outside the thread, " +
        "rather than confabulate across threads. Use it to delegate a thread-scoped analysis or change " +
        "with anti-drift bounded context. Returns { result, escalated }. The agent is a ONE-SHOT REASONING " +
        "agent: text in, text out, no tools — it is told it cannot run or test anything, so treat any claim " +
        "in its reply as unverified until you check it. Needs the claude CLI.",
      inputSchema: {
        entryPointId: z.string().describe(
          "The thread's entry-point id (e.g. app.py:create_user_route). The qualified name the UI shows "
          + "(e.g. app:create_user_route) is accepted too."),
        task: z.string().describe("The thread-scoped task for the subagent."),
      },
    },
    async ({ entryPointId, task }) => {
      const r = await ctx.spawnThreadAgent(entryPointId, task);
      if (r.error) {
        return { content: [{ type: "text", text: `Thread agent failed: ${r.error}` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_plan_work",
    {
      description:
        "Decompose a development task into ordered, boundary-annotated WORK PACKETS — deterministically, " +
        "off the IR (lexical remit match + tcall dependency graph; never a semantic guess, never an LLM). " +
        "Each packet names one thread that owns part of the task: why it matched (exact tokens), its " +
        "dependencies-first build order, where its static knowledge ENDS (resolution gaps / runtime " +
        "dispatch / uncaptured counts), which adjacent threads are OUTSIDE the plan (agents must ESCALATE " +
        "there, not guess), and its skill state (ratify context before agents consume it). YOU orchestrate: " +
        "write each packet's task text and dispatch it with vibegraph_spawn_thread_agent in the returned " +
        "order; this tool spawns nothing. Honesty: zero matches returns an empty plan with guidance; " +
        "unmatchedTokens lists code-shaped parts of the task NO thread owns; dependency cycles are " +
        "reported, never silently linearized. `verification` states how to check each packet's output.",
      inputSchema: {
        task: z.string().describe("The development task, naming the code it touches (backticked symbols, file names, or node ids — matching is lexical)."),
        maxPackets: z.number().int().min(1).max(16).optional().describe("Max packets to return (default 8)."),
      },
    },
    async ({ task, maxPackets }) => {
      const plan = ctx.planWork(task, maxPackets);
      return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_start_work_run",
    {
      description:
        "M-AGENT — draft an Agent Manager WORK RUN from a task: plan_work decomposition persisted as a " +
        "DRAFT run the human sees in the board (Agents toolbar button). THIS TOOL CANNOT RATIFY OR RUN " +
        "ANYTHING: ratification and every per-packet approval are human gates in the GUI — propose the " +
        "run, then tell the user to review it — UNLESS `autonomous` is set (ruling:2026-09-12:human-out-of-the-loop), " +
        "in which case the run confirms its own objective when the brief lands and runs to a terminal state with no " +
        "human gate, escalations ending as failed packets with their reason kept. One active run at a time; a run " +
        "already in flight is an error, not a replacement.",
      inputSchema: {
        task: z.string().describe("The development task, naming the code it touches (matching is lexical over the IR)."),
        mode: z.enum(["gated", "orchestrated"]).optional().describe(
          "gated (default): the human ratifies the plan AND reviews every packet's evidence. "
          + "orchestrated (M-ORCH): an orchestrator brief writes each packet's task + constraint handoff; the human "
          + "confirms only the OBJECTIVE, the orchestrator reviews packet evidence; escalations and broken output "
          + "contracts still return to the human."),
        parallel: z.number().int().min(1).max(8).optional().describe(
          "M-ORCH.4 — LANES: how many packets may run at once (default 3 orchestrated, 1 gated). Only packets with "
          + "no dependency between them AND disjoint edit scopes (the brief's declared files) share the lanes; the "
          + "chokepoint refuses a worker's edit outside its scope."),
        review: z.enum(["full", "pre-checks"]).optional().describe(
          "M-ORCH.4 — orchestrated only. 'pre-checks' (default): a packet whose deterministic checks pass (edits inside "
          + "its scope, every file re-parsed, entry-point signature unchanged, no new resolution gaps, first attempt, "
          + "not a system packet) is approved WITHOUT a model review and recorded as such; 'full': the orchestrator reads every diff."),
        autonomous: z.boolean().optional().describe(
          "AUTONOMY (ruling:2026-09-12:human-out-of-the-loop): orchestrated only. The run confirms its own objective the moment the "
          + "brief lands and resolves every escalation as a FAILED packet with its reason kept, so no human gate exists; "
          + "the run record and summary name the ruling. Default false."),
      },
    },
    async ({ task, mode, parallel, review, autonomous }) => {
      const res = ctx.startWorkRun(task, mode, { parallel, review, autonomous });
      if (!res.ok) throw new Error(res.message);
      return { content: [{ type: "text", text: res.message }] };
    },
  );

  server.registerTool(
    "vibegraph_sweep_thread_skills",
    {
      description:
        "M-SKILL.4 — draft a thread-skill for EVERY thread that lacks an authoritative one (missing, " +
        "unratified draft, or stale). Serial, one drafting agent per thread — can take a while on big " +
        "projects. Output is ALWAYS status=draft: a human still reviews and ratifies each skill " +
        "individually (the skill card in the UI, or by editing the file's status line). A thread whose " +
        "draft fails the grounding gate is listed in `failed` with the reason — never silently skipped. " +
        "Returns { total, drafted, failed, skipped } (skipped = already authoritative). Needs the claude CLI.",
      inputSchema: {},
    },
    async () => {
      try {
        const summary = await ctx.sweepThreadSkills();
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Skill sweep failed: ${err?.message ?? err}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "vibegraph_explain_node",
    {
      description:
        "Get Claude's LIKELY-purpose inference for an unresolved or external node (e.g. F.relu, " +
        "torch.stack, jsonify) — the ones with no resolvable source. Returns { interpretation, " +
        "attribution, cached }. CRITICAL: the interpretation is LABELLED inference, NOT a resolved " +
        "fact — it ranks below the honest IR state and does not change the node's unresolved/external " +
        "classification. interpretation is null when the node has no source span or the claude CLI is " +
        "unavailable (the attribution still travels). Cached per node + source hash. For a node with " +
        "real project source, use vibegraph_get_node_source instead.",
      inputSchema: {
        nodeId: z.string().describe("Structural-path id of the unresolved/external node's call site."),
        filePath: z.string().optional().describe("Project-mode: file the node lives in (relative or absolute)."),
      },
    },
    async ({ nodeId, filePath }) => {
      const r = await ctx.explainNode(nodeId, filePath);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_generate_thread_skill",
    {
      description:
        "Draft a THREAD SKILL for the thread at entryPointId: durable, grounded guidance (purpose / " +
        "architecture / cited steps / gotchas) for future agents on this thread, plus a deterministic " +
        "'Not statically known' block appended as IR fact (the thread's resolution gaps / runtime " +
        "dispatch / uncaptured calls). Always written status=draft and persisted under " +
        ".vibegraph/thread-skills/. It becomes authoritative ONLY after a HUMAN reviews and ratifies it " +
        "(edits the file's status to ratified) — you cannot ratify it yourself, and there is no tool here " +
        "that lets you. A model MAY ratify only under a recorded human ruling, through " +
        "scripts/draft_thread_skills.mjs, and the file then names the model and the ruling so every prompt " +
        "the skill is injected into carries that caveat. Regenerating resets it " +
        "to draft. Returns the drafted body.",
      inputSchema: {
        entryPointId: z.string().describe("The thread's entry-point id (e.g. app.py:create_user_route)."),
      },
    },
    async ({ entryPointId }) => {
      const r = await ctx.generateThreadSkill(entryPointId);
      if (!r.ok) {
        return { content: [{ type: "text", text: `Thread-skill generation failed: ${r.error ?? "unknown"}` }], isError: true };
      }
      return { content: [{ type: "text", text: r.body ?? "" }] };
    },
  );

  server.registerTool(
    "vibegraph_get_thread_skill",
    {
      description:
        "Read the thread-skill for entryPointId: its status (draft|ratified), staleness vs the current " +
        "thread IR, and body. Only a ratified, non-stale skill is authoritative — a draft is unreviewed, " +
        "and a stale one was ratified against an older version of the thread. exists:false when none has " +
        "been generated. Read-only.",
      inputSchema: {
        entryPointId: z.string().describe("The thread's entry-point id."),
      },
    },
    async ({ entryPointId }) => {
      const r = ctx.getThreadSkill(entryPointId);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_blast_radius",
    {
      description:
        "Impact analysis before editing a node: what depends on it. Returns `dependents` (the " +
        "statically-linked callers — a reverse reference index, each with its enclosing function, the " +
        "unit that breaks if you change the target), `threads` (the entry-point flows that pass through " +
        "it), and `possibleHiddenCallers`. HONESTY: `dependents` is provable callers ONLY — a caller " +
        "that reaches the target through a dynamic dispatch (getattr / a runtime-bound receiver) or an " +
        "unresolved name emits NO edge and is NOT listed; `possibleHiddenCallers` are name-matched " +
        "dynamic/unresolved terminals (a heuristic, UNVERIFIED). nodeId should be the target " +
        "function/class def (e.g. module/query.fn). Read-only.",
      inputSchema: {
        nodeId: z.string().describe("Structural-path id of the node whose impact you want (usually a function/class def)."),
        filePath: z.string().optional().describe("Project-mode: file the node lives in (relative or absolute)."),
      },
    },
    async ({ nodeId, filePath }) => {
      const r = ctx.blastRadius(nodeId, filePath);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_validate_citations",
    {
      description:
        "Self-check the IR node-id citations in a chunk of your prose BEFORE you rely on it. Pass the " +
        "text; returns { cited, grounded, ungrounded, ok }. `ungrounded` are node ids you cited that do " +
        "NOT exist in the current IR — hallucinated citations to fix or drop. The grounding contract: " +
        "tie every claim about the code to a real node id (`module/...` structural path); a claim with " +
        "no node id must be labelled as not node-grounded. Read-only.",
      inputSchema: {
        text: z.string().describe("Prose whose `module/...` node-id citations should be validated."),
      },
    },
    async ({ text }) => {
      const r = ctx.validateCitations(text);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_thread_assertions",
    {
      description:
        "The behavioural CONTRACT of the thread at seedNodeId — position/order/effect assertions " +
        "grounded in the IR, to write a real regression test (not a smoke test). Returns `order` (the " +
        "ordered execution path: seed + steps), `effects` (side effects on the path, with position), " +
        "`terminals` (external/dynamic/unresolved boundaries by kind), and `invariants` (human-readable, " +
        "testable strings like \"step 2 is step 'query'\" / \"a terminal ('conn.execute') touches db\"). " +
        "Deterministic IR fact, not LLM prose. Render the invariants into whatever test format fits. " +
        "Read-only.",
      inputSchema: {
        seedNodeId: z.string().describe("Structural-path id of the thread's seed function."),
        filePath: z.string().optional().describe("Project-mode: file the seed lives in (relative or absolute)."),
      },
    },
    async ({ seedNodeId, filePath }) => {
      const r = await ctx.threadAssertions(seedNodeId, filePath);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_thread_blind_spots",
    {
      description:
        "The honesty roll-up for the thread seeded at seedNodeId: what in the thread is NOT statically " +
        "known. Call this to find exactly where to read source / run / ask instead of guessing. Returns " +
        "three blind-spot buckets — resolutionGaps (kind=unresolved: the linker could not resolve it, " +
        "often a fixable import/link gap, NOT runtime-determined), runtimeDispatch (kind=dynamic: genuine " +
        "runtime dispatch via getattr or a runtime-bound receiver — inherent, not a gap; each carries how " +
        "its receiver was bound), and uncaptured (the statement hides calls the parser did not decompose " +
        "into the IR — chains/comprehensions/literals — so the thread is genuinely incomplete there). " +
        "Plus a separate `effects` axis (parse-time effectKind at the thread's steps — known-but-impure, " +
        "NOT a blind spot; for an authoritative per-run effect verdict use vibegraph_run_thread_to_node). " +
        "`staticallyComplete` is true only when there are no resolutionGaps and no uncaptured nodes " +
        "(runtimeDispatch does not count against it). Pure IR fact, read-only.",
      inputSchema: {
        seedNodeId: z.string().describe("Structural-path id of the thread's seed function."),
        filePath: z.string().optional().describe("Project-mode: file the seed lives in (relative or absolute)."),
      },
    },
    async ({ seedNodeId, filePath }) => {
      const r = await ctx.threadBlindSpots(seedNodeId, filePath);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  // ── M-CONTRACT (PLAN-M-CONTRACT.md) — thread contract + stated constraints ──
  server.registerTool(
    "vibegraph_thread_contract",
    {
      description:
        "M-CONTRACT — the DATA CONTRACT of one thread (entryPointId), IR FACT: what enters (the seed's " +
        "params), what leaves (declared return + the return expressions), every effectful external call " +
        "with its LITERAL call text (the endpoint / SQL / path / command the code actually uses), round " +
        "trips inside loops (the N+1 lever, named per loop and via which step), cross-thread adjacency " +
        "(the handoff surface), and where static knowledge ends. Plus the STATED constraints routed to " +
        "this thread (payload schemas, proxies, backend-call requirements, perf levers, invariants) — each " +
        "labelled with its source: human-stated (authoritative), orchestrator-stated, or agent-stated. " +
        "`rendered` holds the exact prompt blocks a worker/thread agent receives. Read-only.",
      inputSchema: {
        entryPointId: z.string().describe("The thread's entry-point id (e.g. api/app.py:create_order)."),
      },
    },
    async ({ entryPointId }) => {
      const r = ctx.threadContract(entryPointId);
      if (r.error && !r.contract) {
        return { content: [{ type: "text", text: `Thread contract failed: ${r.error}` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_state_constraint",
    {
      description:
        "M-CONTRACT — state an architecture CONSTRAINT the IR cannot see, so every agent working the " +
        "threads it scopes receives it: kind payload-schema (what shape a payload must keep), proxy (what " +
        "fronts a call), backend-call (what a backend expects), perf-lever (batch vs round-trip: when to " +
        "reduce round trips rather than micro-optimise), invariant, objective, or M-STACK's stack-policy " +
        "(a decision ABOUT A TOOL — prefer the project's http wrapper over bare requests; the tensor " +
        "program is torch, do not add tensorflow). A stack-policy REQUIRES `policy` " +
        "{ tool, rule: require|prefer|forbid|replace-with, with (required for replace-with), role?, " +
        "reason? } — that structured form is what the deterministic post-packet checks read; `text` stays " +
        "the human sentence. Scope it to threads (entryPointIds), files (a trailing / matches a " +
        "directory), TOOLS (scope.stack — names from vibegraph_stack; it reaches every thread whose stack " +
        "uses one, and keeps reaching new files that adopt the tool), or everything (all: true). " +
        "Persisted to .vibegraph/constraints.json with source \"agent\" — it is injected LABELLED as " +
        "agent-stated, NOT reviewed by a human, never as human-authoritative. A human can remove it in " +
        "the Agent Manager board.",
      inputSchema: {
        kind: z.enum(["payload-schema", "proxy", "backend-call", "perf-lever", "invariant", "objective", "stack-policy"]),
        text: z.string().describe("The constraint, one or two sentences, concrete (name the shape / host / lever / tool)."),
        scope: z.object({
          all: z.boolean().optional(),
          entryPointIds: z.array(z.string()).optional(),
          files: z.array(z.string()).optional(),
          stack: z.array(z.string()).optional(),
        }).describe("Who receives it: threads by entryPointId, files (dir prefix with trailing /), tools (stack), or all."),
        check: z.union([
          z.object({ rule: z.literal("callers-only"), target: z.string(), files: z.array(z.string()).optional(), functions: z.array(z.string()).optional() }),
          z.object({ rule: z.literal("import-only"), tool: z.string(), files: z.array(z.string()) }),
          z.object({ rule: z.literal("calls-through"), target: z.string(), through: z.string() }),
        ]).optional().describe(
          "M-GRAMMAR — the CHECKABLE half, when the rule is one the IR can settle: "
          + "callers-only (every caller of `target` is in these files/functions), "
          + "import-only (only these files may import `tool`), "
          + "calls-through (every call to `target` goes through `through`). "
          + "`text` stays the human sentence; this is what the deterministic pre-checks EVALUATE, "
          + "so the rule stops being prose a reviewer reads and agrees with. "
          + "A constraint the IR cannot settle comes back `unverifiable` and goes to the model — never a silent pass.",
        ),
        policy: z.object({
          tool: z.string(),
          rule: z.enum(["require", "prefer", "forbid", "replace-with"]),
          with: z.string().optional(),
          role: z.string().optional(),
          reason: z.string().optional(),
        }).optional().describe("Required for kind stack-policy; allowed on any other kind (a `proxy` constraint stating which tool fronts a call is the same decision) — the deterministic checks read `policy` wherever it appears."),
        note: z.string().optional().describe("Provenance note (e.g. which task or document it comes from)."),
      },
    },
    async (input) => {
      const r = ctx.stateConstraint(input);
      if (!r.ok) return { content: [{ type: "text", text: `Constraint rejected: ${r.error}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(r.constraint, null, 2) }] };
    },
  );

  // ── M-STACK.1 (PLAN-M-STACK.md) — the stack facts ──────────────────
  server.registerTool(
    "vibegraph_stack",
    {
      description:
        "M-STACK — the SOFTWARE STACK this project actually uses, derived from the IR and the manifests " +
        "on disk: every tool with its ROLE (web-framework / frontend / http-client / db / cache / queue / " +
        "tensor / data / cloud / infra / process / remote / test / build / runtime / unknown), its ORIGIN " +
        "(third-party, stdlib, or a PROJECT module that funnels one — the proxy case, carrying `wraps`), " +
        "its declared version when a manifest names one, the files and threads it appears in, and the " +
        "parse EVIDENCE behind it (import / call / include, or `config` for a manifest-only fact — the " +
        "only kind of fact available about an unparsed .js frontend). Pass entryPointId for ONE thread's " +
        "slice. Facts only: a tool no table knows is listed with role \"unknown\" rather than guessed, and " +
        "a stated DECISION about a tool is not here — that is a constraint of kind \"stack-policy\" " +
        "(vibegraph_list_constraints). Read-only.",
      inputSchema: {
        entryPointId: z.string().optional().describe("Restrict to one thread's tools (e.g. telemetry/app.py:ingest_route)."),
      },
    },
    async ({ entryPointId }) => {
      const r = ctx.stack(entryPointId);
      if (r.error) return { content: [{ type: "text", text: `Stack unavailable: ${r.error}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  // - M-XLANG.1 (PLAN-M-V5FORKS.md) - the cross-language crossings -
  server.registerTool(
    "vibegraph_crossings",
    {
      description:
        "M-XLANG - where a logic thread LEAVES its own language over HTTP, and which route in this " +
        "project serves the path it calls. Both sides are parsed data: the caller's URL argument (a " +
        "template literal is reduced to its static path shape, `${BASE}/devices/${id}` -> /devices/*) and " +
        "the receiver's route metadata from any language's discoverer. The match is WEIGHED, never " +
        "resolved: `confidence` is path+method only when BOTH sides parsed a method (two framework " +
        "defaults agreeing is not evidence), `ambiguous` names every candidate and claims none, and " +
        "`unmatched` means the path resolved but nothing here serves it. A route served inside the " +
        "calling thread's own files is excluded - a service calling itself is not a crossing. `note` " +
        "always says what the match could NOT establish, including that the base URL was never " +
        "followed. A crossing does NOT widen the thread: `filesReached` stays one language. " +
        "Pass entryPointId for one thread. Read-only.",
      inputSchema: {
        entryPointId: z.string().optional().describe("Restrict to one thread's crossings (e.g. gateway/server.ts:postIngestRoute)."),
      },
    },
    async ({ entryPointId }) => {
      const r = ctx.crossings(entryPointId);
      if (r.error) return { content: [{ type: "text", text: `Crossings unavailable: ${r.error}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  // - M-ARCH.1 (PLAN-M-ARCH.md) - the architecture layer -
  server.registerTool(
    "vibegraph_architecture",
    {
      description:
        "M-ARCH - the project's ARCHITECTURE as a small graph, derived from the IR (no model involved): " +
        "CLUSTERS of entry points (a framework's family - Next.js app, MCP server, HTTP API per framework, " +
        "scripts, CLI - under the nearest package manifest), TOOL nodes for every boundary tool a cluster's " +
        "threads call (database, platform, model API, HTTP client, agent protocol, cloud, remote, or " +
        "`unknown`, named), and EDGES aggregating the hops between clusters (http / command / tool) and the " +
        "calls into tools. Every edge carries a `protocol` READ FROM THE FACT with `protocolBasis` saying " +
        "which fact (`SQL` because pg is a SQL client; `Volt - WebSocket - command` because the calling " +
        "thread calls @tdxvolt/volt-client-web), a count, the threads, and refs to the call sites (file + IR " +
        "node id, which is also an edit address). `unplaced` counts what the picture leaves out. `groups` " +
        "(deployment/trust boundaries) are stated or proposed, never derived. Read-only.",
      inputSchema: {},
    },
    async () => {
      const r = ctx.architecture();
      if (!r.model) return { content: [{ type: "text", text: `Architecture unavailable: ${r.error ?? "no model"}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(r.model, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_propose_architecture",
    {
      description:
        "M-ARCH.4 - SPENDS TOKENS. Ask a model to propose what the code cannot say about the architecture: " +
        "deployment / trust GROUPS (host, region, subnet, trust, network, process, account, zone) wrapping the " +
        "derived nodes, display NAMES, the PRIMARY PATH and a two-sentence narrative. The model sees the derived " +
        "model, deployment facts read line by line from compose / Dockerfile / k8s / terraform / pm2 / Procfile / " +
        "systemd / .env.example, and the project's docs; every item must cite one of those (file:line) or a node / " +
        "edge id, and a citation that was not shown is dropped - an item left with none is INFERRED. The model " +
        "cannot add a node or an edge, or say anything about protocols or payloads. The result is stored PENDING in " +
        ".vibegraph/architecture.json and shown ghosted; only a human ratifies or rejects it, in the GUI.",
      inputSchema: {},
    },
    async () => {
      const r = await ctx.proposeArchitecture();
      if (!r.ok) return { content: [{ type: "text", text: `Proposal failed: ${r.error ?? "unknown"}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify({ pending: true, groups: r.groups, names: r.names, refused: r.refused, note: "awaiting human ratification in the GUI", groupsNow: r.model?.groups, proposal: r.model?.proposal }, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_list_constraints",
    {
      description:
        "M-CONTRACT — every stated constraint in the analyzed project (.vibegraph/constraints.json) with " +
        "its kind, scope, and source (human / orchestrator / agent). Read-only.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(ctx.listConstraints(), null, 2) }] }),
  );

  server.registerTool(
    "vibegraph_run_block",
    {
      description:
        "Execute the source slice of a node (function body or top-level block) in a sandboxed " +
        "subprocess. Returns stdout, stderr, exitCode. Use this to verify an edit's behaviour " +
        "before committing further changes.",
      inputSchema: {
        nodeId: z.string(),
        filePath: z.string().optional(),
      },
    },
    async ({ nodeId, filePath }) => {
      const r = await ctx.runBlock(nodeId, filePath);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_run_thread_to_node",
    {
      description:
        "Run the real code path up to an IR node and capture that node's VALUE, without writing " +
        "the file (an ephemeral probe is injected into a temp copy, then discarded). Prefer this " +
        "over vibegraph_run_block for debugging and edit-verification: it returns the captured value " +
        "with honest, distinct outcomes instead of raw stdout you must scrape. " +
        "nodeId must be the value-of-interest: a plain-identifier `assignment` node (e.g. " +
        "module/happy.fn/result.assign) inside a module-level function OR a method (the server derives " +
        "the entry function, value expression, and — for a method — the class itself; it does not " +
        "trust a client derivation). A method runs on a synthesized example instance: pass " +
        "synthInstanceArgs as constructor param -> literal expression ({} for all-defaults); the " +
        "constructor's effect path is scanned too and the result is labelled synthesized-input. " +
        "Outcome is one of: ok | probe-not-reached | value-opaque | stop-not-enforced | import-error | " +
        "runtime-error | timeout | value-ambiguous | needs-inputs | unsupported-target | " +
        "requires-confirmation | harness-error. `provenance` is real-input, or synthesized-input when " +
        "synthArgs were used. SAFETY: an interprocedural effect scan runs first; a side-effectful or " +
        "dynamic/unresolved path returns outcome='requires-confirmation' with `effects` (what it would " +
        "do) and a scope-bound `effectConsentToken` — re-call with that string as `effectConsent` to " +
        "actually run. A stale/tampered token (or one minted before a server restart) is rejected and " +
        "you get a fresh token back, never a silent run. For an entry function that needs arguments, " +
        "outcome='needs-inputs' — pass synthArgs as a map of param -> literal expression (validated as " +
        "literals before injection).",
      inputSchema: {
        nodeId: z.string().describe("Structural-path id of the value-of-interest assignment node."),
        filePath: z.string().optional().describe("Project-mode: file the node lives in (relative or absolute)."),
        synthArgs: z.record(z.string(), z.string()).optional()
          .describe("param -> literal-expression map for an arg-needing entry function."),
        effectConsent: z.string().optional()
          .describe("The effectConsentToken from a prior requires-confirmation, to authorise an effectful run."),
        synthInstanceArgs: z.record(z.string(), z.string()).optional()
          .describe("METHOD targets: constructor param -> literal-expression map for the synthesized example instance ({} = all-defaults)."),
      },
    },
    async ({ nodeId, filePath, synthArgs, effectConsent, synthInstanceArgs }) => {
      const r = await ctx.runThreadToNode({ nodeId, filePath, synthArgs, effectConsent, synthInstanceArgs });
      // The honest-outcome envelope IS the result — never collapsed to isError,
      // so the agent reads `outcome`/`provenance`/`effects` directly.
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );

  server.registerTool(
    "vibegraph_run_thread_to_node_override",
    {
      description:
        "What-if debugging: re-bind an upstream variable to a value, then run to a downstream node and " +
        "capture ITS value — WITHOUT writing the file (ephemeral, like run_thread_to_node). overrideNodeId " +
        "is a plain-identifier assignment whose variable gets re-bound to `value` right after it; nodeId is " +
        "the downstream value-of-interest assignment to capture. `value` MUST be a literal expression " +
        "(numbers/strings/lists/dicts/tuples/bools/None — no calls, names, or f-strings); it passes the " +
        "same literal-only gate as synthesized args. The result has provenance=synthesized-input and an " +
        "`override` field naming the applied assignment, so the captured value is read under that premise. " +
        "Same SM3 effect floor + consent as run_thread_to_node (an effectful path returns " +
        "requires-confirmation + a token). Honest declines: unsupported-target (override not a " +
        "plain-identifier assignment, or a node in an else/try body), value-ambiguous (value not a literal), " +
        "needs-inputs (the entry function needs args — not supported with override in v1).",
      inputSchema: {
        nodeId: z.string().describe("Downstream value-of-interest assignment node to capture."),
        overrideNodeId: z.string().describe("Upstream plain-identifier assignment node to re-bind."),
        value: z.string().describe("Literal expression to bind the override variable to."),
        filePath: z.string().optional().describe("Project-mode: file the nodes live in."),
        effectConsent: z.string().optional().describe("Token from a prior requires-confirmation, to authorise an effectful run."),
      },
    },
    async ({ nodeId, overrideNodeId, value, filePath, effectConsent }) => {
      const r = await ctx.runThreadToNodeOverride({ nodeId, overrideNodeId, value, filePath, effectConsent });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    },
  );
}

function registerResources(server: McpServer, ctx: VibegraphMcpContext): void {
  server.registerResource(
    "project-ir",
    VIBEGRAPH_RESOURCE_PROJECT_IR,
    {
      title: "VibeGraph project IR",
      description:
        "Project envelope IR (schemas/project_ir.schema.json, v2.0). Wraps every file's per-file IR " +
        "in { version, files, symbolIndex, entryPoints, threads }. entryPoints/threads ship empty until " +
        "M8.2/M8.3.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(ctx.getProjectIR(), null, 2),
      }],
    }),
  );

  server.registerResource(
    "selection",
    VIBEGRAPH_RESOURCE_SELECTION,
    {
      title: "VibeGraph current selection",
      description: "The webview's currently-selected node, or { nodeId: null } if nothing is selected.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(ctx.getSelection(), null, 2),
      }],
    }),
  );

  server.registerResource(
    "shape-grammar",
    VIBEGRAPH_RESOURCE_SHAPE_GRAMMAR,
    {
      title: "VibeGraph shape grammar reference",
      description:
        "Reference table mapping construct → silhouette / role colour / ports. Use this when " +
        "suggesting visual / structural edits so suggestions match the grammar the user sees.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: ctx.getShapeGrammarReference(),
      }],
    }),
  );

  // Per-file IR + source as a ResourceTemplate so clients can request
  // vibegraph://files/<path>/ir or vibegraph://files/<path>/source.
  server.registerResource(
    "file-ir",
    new ResourceTemplate(
      "vibegraph://files/{path}/ir",
      {
        list: async () => ({
          resources: ctx.listFiles().map((p) => ({
            uri: `vibegraph://files/${encodeURIComponent(p)}/ir`,
            name: `IR: ${p}`,
            mimeType: "application/json",
          })),
        }),
      },
    ),
    {
      title: "VibeGraph per-file IR",
      description: "Parsed IR for a single file, by path.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const raw = (variables as { path?: string | string[] }).path;
      if (!raw) {
        return {
          contents: [{ uri: uri.href, mimeType: "text/plain", text: "Error: missing path variable" }],
        };
      }
      const rawPath = Array.isArray(raw) ? raw[0] : raw;
      const p = decodeURIComponent(rawPath);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(ctx.getProjectIR(p), null, 2),
        }],
      };
    },
  );

  server.registerResource(
    "file-source",
    new ResourceTemplate(
      "vibegraph://files/{path}/source",
      {
        list: async () => ({
          resources: ctx.listFiles().map((p) => ({
            uri: `vibegraph://files/${encodeURIComponent(p)}/source`,
            name: `Source: ${p}`,
            mimeType: "text/x-python",
          })),
        }),
      },
    ),
    {
      title: "VibeGraph per-file source",
      description: "Raw .py source on disk for a single file.",
      mimeType: "text/x-python",
    },
    async (uri, variables) => {
      const raw = (variables as { path?: string | string[] }).path;
      if (!raw) {
        return {
          contents: [{ uri: uri.href, mimeType: "text/plain", text: "Error: missing path variable" }],
        };
      }
      const rawPath = Array.isArray(raw) ? raw[0] : raw;
      const p = decodeURIComponent(rawPath);
      const r = ctx.readFileSource(p);
      if ("error" in r) {
        return {
          contents: [{ uri: uri.href, mimeType: "text/plain", text: `Error: ${r.error}` }],
        };
      }
      return {
        contents: [{ uri: uri.href, mimeType: "text/x-python", text: r.source }],
      };
    },
  );

  // M20.1 — dynamic READMEs (PLAN-v5 §2). Pull-on-demand summaries with a
  // staleness flag (stored sourceHash vs the current IR). The JSON body
  // carries { exists, stale, body, ... } so the agent knows whether to
  // trust or refresh. Generation (writing bodies) is M20.2.
  const readmeContents = (uri: { href: string }, result: unknown) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(result, null, 2) }],
  });
  const readmeVar = (raw: string | string[] | undefined): string | null => {
    if (!raw) return null;
    return decodeURIComponent(Array.isArray(raw) ? raw[0] : raw);
  };

  server.registerResource(
    "thread-readme",
    new ResourceTemplate(
      VIBEGRAPH_RESOURCE_THREAD_README,
      {
        list: async () => ({
          resources: (ctx.listEntryPoints() as Array<{ id: string }>).map((e) => ({
            uri: `vibegraph://thread/${encodeURIComponent(e.id)}/readme`,
            name: `README: thread ${e.id}`,
            mimeType: "application/json",
          })),
        }),
      },
    ),
    {
      title: "VibeGraph thread README",
      description:
        "Dynamic per-thread summary (context anchor). Pull this instead of re-reading every file a " +
        "thread touches. JSON: { exists, stale, body, sourceHash, generatedAt }. stale=true means the " +
        "thread's IR changed since the README was written — refresh before trusting it.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = readmeVar((variables as { id?: string | string[] }).id);
      if (!id) return readmeContents(uri, { error: "missing id variable" });
      return readmeContents(uri, ctx.getReadme("thread", id));
    },
  );

  server.registerResource(
    "file-readme",
    new ResourceTemplate(
      VIBEGRAPH_RESOURCE_FILE_README,
      {
        list: async () => ({
          resources: ctx.listFiles().map((p) => ({
            uri: `vibegraph://files/${encodeURIComponent(p)}/readme`,
            name: `README: file ${p}`,
            mimeType: "application/json",
          })),
        }),
      },
    ),
    {
      title: "VibeGraph file README",
      description:
        "Dynamic per-file summary (context anchor). JSON: { exists, stale, body, sourceHash, generatedAt }. " +
        "stale=true means the file's IR changed since the README was written.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const p = readmeVar((variables as { path?: string | string[] }).path);
      if (!p) return readmeContents(uri, { error: "missing path variable" });
      return readmeContents(uri, ctx.getReadme("file", p));
    },
  );
}

// M-ORCH.4 — a WORKER session announces its packet in its MCP URL
// (`/mcp?packet=p3`, set by the server that spawned it). Every write tool
// registered on that session carries the packet id down to the chokepoint,
// which confines the edit to the packet's EDIT SCOPE — so parallel packets
// can never touch each other's files, and a stray edit is refused with the
// owning packet named. A session without the parameter (the GUI chat, an
// external `claude mcp add` session) is unscoped, exactly as before.
const PACKET_ID_RE = /^[px]\d{1,4}$/;

export function packetIdFromUrl(url: string | undefined): string | null {
  try {
    const id = new URL(url ?? "/", "http://vibegraph").searchParams.get("packet");
    return id && PACKET_ID_RE.test(id) ? id : null;
  } catch { return null; }
}

function scopedContext(ctx: VibegraphMcpContext, packetId: string): VibegraphMcpContext {
  return {
    ...ctx,
    rewriteNode: (args) => ctx.rewriteNode({ ...args, packetId }),
    composeInsert: (args) => ctx.composeInsert({ ...args, packetId }),
    createFile: (p, source) => ctx.createFile(p, source, packetId),
  };
}

export function createMcpHttpHandler(ctx: VibegraphMcpContext) {
  const sessions = new Map<string, ConnectedSession>();

  async function makeSession(packetId: string | null): Promise<ConnectedSession> {
    const server = new McpServer({ name: "vibegraph", version: "0.1.0" });
    registerTools(server, packetId ? scopedContext(ctx, packetId) : ctx);
    registerResources(server, ctx);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, session);
      },
    });

    // Bridge VibeGraph state changes to MCP resource-updated notifications.
    // Clients that have subscribed (via resources/subscribe) get a push;
    // others can poll the resource on their own cadence.
    const unsubSel = ctx.onSelectionChanged(() => {
      server.server
        .sendResourceUpdated({ uri: VIBEGRAPH_RESOURCE_SELECTION })
        .catch(() => { /* transport may be closing */ });
    });
    const unsubProj = ctx.onProjectUpdated(() => {
      server.server
        .sendResourceUpdated({ uri: VIBEGRAPH_RESOURCE_PROJECT_IR })
        .catch(() => { /* transport may be closing */ });
    });

    const session: ConnectedSession = {
      transport,
      server,
      unsubscribe: () => {
        unsubSel();
        unsubProj();
      },
    };

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id && sessions.has(id)) {
        sessions.get(id)!.unsubscribe();
        sessions.delete(id);
      }
    };

    await server.connect(transport);
    return session;
  }

  return async function handleMcpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody: unknown,
  ): Promise<void> {
    const headerSid = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(headerSid) ? headerSid[0] : headerSid;
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      const body = parsedBody as { method?: string; id?: unknown } | null;
      if (req.method !== "POST" || !body || body.method !== "initialize") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32600, message: "MCP session not initialised; first request must be POST initialize." },
          id: body?.id ?? null,
        }));
        return;
      }
      session = await makeSession(packetIdFromUrl(req.url));
    }

    await session.transport.handleRequest(req, res, parsedBody);
  };
}
