// M-CMD.2 — the two roles the taxonomy predated, and the stated-role channel.
//
// Root cause pinned here rather than in prose: a hosted-model client and an
// agent-protocol SDK had NO role they could honestly carry, so every member
// of the class read `unknown` together and everything gated on a role lost
// them at once. The fix is the CLASS (a new role every consumer handles),
// the table entries are its first members, and for a tool no public table
// can know, a stated policy's role classifies it with provenance.
//
//   npm run test:stack-roles
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyTool, jstsPackageName, pythonToolName, STACK_ROLES, ROLE_ORDER, ROLE_LABEL, toolNote,
} from "../src/shared/stack_taxonomy.ts";
import { effectFromRole } from "../src/shared/stack_attribution.ts";
import { buildStackIndex } from "../src/server/stack.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("the class exists: two roles, in the order, with labels, and both schemas agree", () => {
  assert.ok(STACK_ROLES.includes("model-api") && STACK_ROLES.includes("agent-protocol"));
  assert.ok(STACK_ROLES.includes("platform"), "M-CMD.3");
  assert.ok(STACK_ROLES.includes("utility"), "M-CMD.3, second finding");
  for (const r of STACK_ROLES) {
    assert.ok(ROLE_ORDER.includes(r), `${r} has a render position`);
    assert.ok(typeof ROLE_LABEL[r] === "string" && ROLE_LABEL[r], `${r} has a label`);
  }
  assert.equal(ROLE_ORDER.length, STACK_ROLES.length);
  // A role added to the type and not to the schemas would validate nothing;
  // the schema enums are the type, byte for byte.
  for (const f of ["schemas/project_ir.schema.json", "schemas/quality/check_grammar.json"]) {
    const text = readFileSync(join(ROOT, f), "utf-8");
    const enums = [...text.matchAll(/"enum": \[([^\]]*"web-framework"[^\]]*)\]/g)].map((m) => [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]));
    assert.ok(enums.length >= 1, `${f} enumerates the roles`);
    for (const e of enums) assert.deepEqual(e, [...STACK_ROLES], `${f} enum == STACK_ROLES`);
  }
});

test("the first members, in every language that has them", () => {
  const py = (t) => classifyTool("python", pythonToolName(t));
  assert.equal(py("openai").role, "model-api");
  assert.equal(py("anthropic").role, "model-api");
  assert.equal(py("google.generativeai.types").role, "model-api", "two-segment key, like google.cloud");
  assert.equal(py("langchain_openai").role, "model-api");
  assert.equal(py("mcp.server.fastmcp").role, "agent-protocol");
  assert.equal(py("fastmcp").role, "agent-protocol");
  const js = (spec) => classifyTool("jsts", jstsPackageName(spec));
  assert.equal(js("openai").role, "model-api");
  assert.equal(js("@anthropic-ai/sdk").role, "model-api");
  assert.equal(js("ai").role, "model-api", "the Vercel AI SDK");
  assert.equal(js("@modelcontextprotocol/sdk/server/mcp.js").role, "agent-protocol", "a subpath keys on the package");
  assert.equal(js("@modelcontextprotocol/sdk/client/stdio.js").role, "agent-protocol");
  assert.equal(js("fastmcp").role, "agent-protocol");
  assert.equal(classifyTool("bash", "ollama").role, "model-api");
  assert.equal(classifyTool("bash", "claude").role, "model-api");
  // A SCOPED FAMILY answers for members no table names — the same gap one
  // level up (`@aws-sdk/credential-provider-cognito-identity` sat in a real
  // codebase's unclassified list beside a table that knew `client-s3`).
  assert.equal(js("@aws-sdk/credential-provider-cognito-identity").role, "cloud");
  assert.equal(js("@aws-sdk/client-s3").role, "cloud", "an exact entry still wins, and agrees");
  assert.equal(js("@google-cloud/pubsub").role, "cloud");
  assert.equal(js("@langchain/community/vectorstores").role, "model-api");
  assert.equal(js("@modelcontextprotocol/server-filesystem").role, "agent-protocol");
  assert.equal(js("@anthropic-ai/claude-code").role, "model-api");
  // And what the tables do NOT know stays unknown — named, never guessed:
  // a bare name, a scope no family claims, a private SDK.
  assert.equal(js("clsx").role, "unknown");
  assert.equal(js("@acme/ledger-client").role, "unknown", "a private SDK: no public table can carry it");
  assert.equal(js("@azure/msal-browser").role, "unknown", "a scope that straddles roles is deliberately not a family");
  assert.equal(py("some_private_sdk").role, "unknown");
  // M-CMD.3 — the class the FIRST real codebase's transport fell through:
  // a backend platform behind one client. The TDX Volt packages are a scope
  // family (four packages, one platform) with ONE exact exception — a wire
  // is a publish/subscribe stream, so `wires` is `queue` and the exact entry
  // wins over its scope. The definitions ride TOOL_NOTES.
  for (const p of ["volt-client", "volt-client-web", "volt-client-grpc", "volt-utility"]) {
    assert.equal(js(`@tdxvolt/${p}`).role, "platform", p);
    assert.ok(toolNote(`@tdxvolt/${p}`), `${p} has a definition`);
  }
  assert.equal(js("@tdxvolt/volt-client-web/js").role, "platform", "a subpath keys on the package");
  assert.equal(js("@tdxvolt/wires").role, "queue");
  assert.match(toolNote("@tdxvolt/wires"), /publish\/subscribe/);
  assert.equal(js("@grpc/grpc-js").role, "http-client");
  assert.equal(js("firebase").role, "platform");
  assert.equal(js("@supabase/supabase-js").role, "platform");
  assert.equal(py("firebase_admin").role, "platform");
  assert.equal(classifyTool("bash", "supabase").role, "platform");
  assert.equal(js("lucide-react").role, "frontend");
  assert.equal(js("@eslint/eslintrc").role, "build");
  assert.equal(toolNote("clsx"), undefined, "a note is documentation for a known tool, never a classifier");
  // M-CMD.3 — an in-process library is `utility`: no effect, never a funnel.
  assert.equal(js("zod").role, "utility");
  assert.equal(js("uuid").role, "utility");
  assert.equal(py("lxml.etree").role, "utility");
  assert.equal(classifyTool("bash", "jq").role, "data", "jq transforms data streams; it is not plumbing");
  assert.equal(effectFromRole({ tool: "zod", role: "utility", origin: "third-party", how: "binding" }), null);
});

test("effects: a model call is a round trip on a strong attribution; an agent-protocol call derives none", () => {
  assert.equal(effectFromRole({ tool: "openai", role: "model-api", origin: "third-party", how: "binding" }), "http");
  assert.equal(effectFromRole({ tool: "openai", role: "model-api", origin: "third-party", how: "qualified" }), "http");
  // The same guards as every other role: a local instance is not a call.
  assert.equal(effectFromRole({ tool: "openai", role: "model-api", origin: "third-party", how: "local-binding" }), null);
  assert.equal(effectFromRole({ tool: "openai", role: "model-api", origin: "third-party", how: "funnel-file" }), null);
  // Registration and dispatch share an import; the role cannot tell them apart.
  assert.equal(effectFromRole({ tool: "@modelcontextprotocol/sdk", role: "agent-protocol", origin: "third-party", how: "binding" }), null);
  // M-CMD.3 — a platform call is a round trip to the platform; a local instance is not.
  assert.equal(effectFromRole({ tool: "@tdxvolt/volt-client-web", role: "platform", origin: "third-party", how: "binding" }), "http");
  assert.equal(effectFromRole({ tool: "@tdxvolt/volt-client-web", role: "platform", origin: "third-party", how: "local-binding" }), null);
});

test("a stated policy's role classifies a tool no table knows — with provenance, and only where the table is silent", () => {
  const files = {
    "lib/ledger.ts": {
      language: "jsts", modulePath: "lib/ledger.ts",
      nodes: [
        { id: "module/import@0", type: "import_from", module: "@acme/ledger-client", names: ["LedgerClient"], line: 1 },
        { id: "module/import@1", type: "import_from", module: "requests-shaped", names: ["x"], line: 2 },
        { id: "module/import@2", type: "import_from", module: "@tdxvolt/volt-client-web", names: ["VoltClient"], line: 3 },
      ],
      edges: [],
    },
  };
  const env = { files, threads: [], entryPoints: [] };
  // No project root → no constraints → the table's answer: unknown.
  const bare = buildStackIndex(env);
  assert.equal(bare.tools.find((t) => t.tool === "@acme/ledger-client").role, "unknown");
  assert.equal(bare.tools.find((t) => t.tool === "@acme/ledger-client").roleSource, undefined);
  // With the fixture root, whose constraints.json states the role (c1, `describe`).
  const FIX = join(ROOT, "test", "fixtures", "webstack", "next_demo");
  const stated = buildStackIndex(env, FIX);
  const volt = stated.tools.find((t) => t.tool === "@acme/ledger-client");
  assert.equal(volt.role, "platform");
  assert.equal(volt.roleSource, "stated");
  assert.equal(volt.roleStatedBy, "c1");
  assert.equal(volt.roleStatedSource, "human");
  assert.equal(volt.origin, "third-party", "a stated ROLE does not invent an origin");
  // M-CMD.3 — a tool the table learned is classified by the TABLE, with no
  // provenance to carry: the stated channel is for what the table cannot say.
  const known = stated.tools.find((t) => t.tool === "@tdxvolt/volt-client-web");
  assert.equal(known.role, "platform");
  assert.equal(known.roleSource, undefined);
  // A tool the table already knows keeps the table's role even if a policy names it.
  assert.equal(stated.tools.find((t) => t.tool === "requests-shaped").role, "unknown", "no policy names it: still unknown");
});
