// M-STACK.1 (PLAN-M-STACK.md) — the STACK TAXONOMY: the roles a tool can
// play, and the per-language EVIDENCE tables that map a parse fact (an
// import root, a package specifier, a shell command word, an include) to
// (tool, role).
//
// Webview-safe: pure data + pure string functions, no node imports — the
// Stack panel and the server index read the SAME table (the languages.ts
// precedent).
//
// FLOOR: this table is EVIDENCE, not inference. A token the table does not
// know becomes role "unknown" and is still listed — the system spec names
// what it cannot classify rather than guessing. Never pattern-match a name
// at runtime.
//
// M-TABLES — the STANDARD LIBRARY halves are no longer edited here at all.
// A hand-written stdlib list is not merely incomplete: absence from it used
// to stamp `origin: "third-party"`, claiming a dependency the project may
// not have, and the Python list held 87 of the 192 roots the interpreter
// reports. Those tables are GENERATED into ./stack_stdlib.generated.ts by
// `npm run gen:stack-tables` and pinned by `npm run test:stack-tables`.
//
// What is still hand-written is what no runtime can be asked: which tool
// plays which ROLE (`requests` is an HTTP client), which coreutils are
// ambient, and the C++ include map — C++ has no runtime to introspect.

import { cloudServiceOf } from "./cloud_services.ts";
import {
  BASH_KEYWORD_NAMES, BASH_SHELL_BUILTIN_NAMES, NODE_BUILTIN_NAMES,
  PYTHON_STDLIB_CURRENT, PYTHON_STDLIB_REMOVED,
} from "./stack_stdlib.generated.ts";

/** Closed set. `runtime` = the language's own standard library (stdlib
 *  with no more specific role); `unknown` = a third-party tool no table
 *  entry knows — listed, never classified by guess. */
// M-CMD.2 — ROOT CAUSE of a whole class of tools reading "unclassified".
//
// On a real codebase `openai` (14 files) and `@modelcontextprotocol/sdk`
// (112 files) carried `role: unknown`, so the funnel rule could not see
// their wrappers, no effect could be derived, the spec filed them under
// "unclassified" and a stack policy could not route by them. Adding the two
// names to a table would not have been honest, because the taxonomy had NO
// ROLE for what they are: `http-client` misdescribes a client of a hosted
// MODEL (a boundary with a per-call cost and a non-deterministic answer),
// and nothing at all describes an SDK that speaks an AGENT PROTOCOL (an MCP
// server registers tools, an MCP client dispatches to them). The vocabulary
// predated the class, so every member of the class fell to `unknown`
// TOGETHER — and everything gated on a role lost all of them at once.
//
// The universal part of the fix is the CLASS, not the two names: once the
// role exists, every consumer (WRAPPABLE, ROLE_EFFECT, ROLE_ORDER, the spec,
// policy routing) handles every member the same way, and a new member is
// one table line. For a member no public table can know — a private
// platform SDK — a STATED policy's `role` classifies it with provenance
// (src/server/stack.ts, `roleStatedBy`), which is the other half.
// M-CMD.3 — the SECOND class the vocabulary lacked, found the same way: a
// real codebase's transport, identity layer and policy boundary
// (`@tdxvolt/*`, five packages) all read `unknown`, and the nearest role a
// person could state for them — `remote` — misdescribes them: `remote` is a
// shell on another machine (ssh, paramiko), which derives a SUBPROCESS
// effect, while a call into a Volt client is a network round trip to a
// platform that holds identity, policy, data AND commands behind one
// client. The same shape as firebase / supabase / appwrite / pocketbase:
// a BACKEND PLATFORM SDK. `platform` is that role; its effect is `http`
// under the strong-attribution guards (stack_attribution.ts), it is
// wrappable (a project module that builds the platform request IS the
// funnel), and TOOL_NOTES below carries a one-line DEFINITION for the
// members whose role alone under-describes them.
// M-CMD.3 (second finding, same day) — `utility`: an IN-PROCESS library
// with no I/O of its own (a schema validator, an id generator, a date
// formatter, an HTML parser handed a string). The first classify pass on a
// real codebase had to file fourteen of them under `data` because nothing
// else fit, and `data` is wrappable — so 52 "funnels wrapping zod" appeared
// at once, the M-CMD.1 noise class by another door. `utility` derives no
// effect, is never wrappable, and renders with the ambient roles.
export type StackRole =
  | "web-framework" | "frontend" | "http-client"
  | "model-api" | "agent-protocol" | "platform"
  | "db" | "cache" | "queue"
  | "tensor" | "data" | "cloud" | "infra" | "process" | "remote" | "test"
  | "build" | "utility" | "runtime" | "unknown";

export const STACK_ROLES: readonly StackRole[] = [
  "web-framework", "frontend", "http-client", "model-api", "agent-protocol", "platform",
  "db", "cache", "queue",
  "tensor", "data", "cloud", "infra", "process", "remote", "test",
  "build", "utility", "runtime", "unknown",
];

/** Render order for the system spec / panel: the roles that decide an
 *  architecture first, the ambient ones last. */
export const ROLE_ORDER: readonly StackRole[] = [
  "web-framework", "frontend", "http-client", "model-api", "agent-protocol", "platform",
  "db", "cache", "queue",
  "tensor", "data", "cloud", "remote", "process", "infra", "build",
  "test", "utility", "runtime", "unknown",
];

export const ROLE_LABEL: Record<StackRole, string> = {
  "web-framework": "web framework",
  frontend: "frontend",
  "http-client": "HTTP client",
  "model-api": "model API (LLM / embedding / vision service)",
  "agent-protocol": "agent protocol (MCP)",
  platform: "platform SDK (a backend platform behind one client: identity, policy, data, commands)",
  db: "database",
  cache: "cache",
  queue: "queue",
  tensor: "tensor program",
  data: "data / numerics",
  cloud: "cloud SDK",
  infra: "infrastructure",
  process: "subprocess",
  remote: "remote access",
  test: "test",
  build: "build",
  utility: "in-process library (parsing, validation, formatting, scheduling — no I/O of its own)",
  runtime: "standard library",
  unknown: "unclassified",
};

/** Where a tool comes from. `project` = the project's own module that
 *  funnels a third-party tool (the proxy/wrapper case).
 *
 *  M-TABLES — `unknown` exists because the alternative is a LIE. Before it,
 *  `classifyTool` had no third answer, so every token no table recognised
 *  was stamped `third-party` — asserting a dependency the project may not
 *  have. Where the standard library can be enumerated (python, node) that
 *  stamp is now sound: absence from a COMPLETE list is evidence. Where it
 *  cannot be (a bash command word could be coreutils, a third-party CLI, or
 *  a script on PATH), the honest answer is that we do not know. */
export type StackOrigin = "third-party" | "stdlib" | "project" | "unknown";

// ── python ───────────────────────────────────────────────────────────
// Keyed by the import ROOT (first dotted segment), except the two-segment
// entries which are matched on the first TWO segments first.

export const PYTHON_TOOLS: Record<string, StackRole> = {
  requests: "http-client", httpx: "http-client", urllib: "http-client",
  urllib3: "http-client", aiohttp: "http-client", http: "http-client",
  flask: "web-framework", fastapi: "web-framework", django: "web-framework",
  starlette: "web-framework", bottle: "web-framework",
  sqlite3: "db", psycopg2: "db", psycopg: "db", sqlalchemy: "db",
  pymongo: "db", asyncpg: "db", mysql: "db",
  redis: "cache", memcache: "cache",
  celery: "queue", pika: "queue", kombu: "queue",
  torch: "tensor", tensorflow: "tensor", jax: "tensor", keras: "tensor",
  numpy: "data", pandas: "data", sklearn: "data", scipy: "data",
  matplotlib: "data",
  boto3: "cloud", botocore: "cloud", azure: "cloud",
  "google.cloud": "cloud",
  subprocess: "process", multiprocessing: "process",
  paramiko: "remote", fabric: "remote",
  pytest: "test", unittest: "test",
  // M-CMD.3 — backend platform SDKs (see StackRole `platform`).
  firebase_admin: "platform", supabase: "platform", appwrite: "platform", pocketbase: "platform",
  // M-CMD.3 — in-process libraries (see StackRole `utility`).
  lxml: "utility", bs4: "utility", pydantic: "utility", dateutil: "utility", demjson3: "utility",
  json5: "utility", attrs: "utility", marshmallow: "utility",
  // M-CMD.2 — hosted-model clients and agent-protocol SDKs (see StackRole).
  openai: "model-api", anthropic: "model-api", cohere: "model-api",
  mistralai: "model-api", groq: "model-api", ollama: "model-api",
  litellm: "model-api", replicate: "model-api", together: "model-api",
  vertexai: "model-api", huggingface_hub: "model-api",
  "google.generativeai": "model-api", "google.genai": "model-api",
  langchain: "model-api", langchain_core: "model-api",
  langchain_openai: "model-api", langchain_anthropic: "model-api",
  mcp: "agent-protocol", fastmcp: "agent-protocol",
};

/** Every Python stdlib root, GENERATED from `sys.stdlib_module_names`
 *  (M-TABLES) rather than remembered — the hand-written list held 87 of
 *  192, and absence from it stamped a standard module `third-party`.
 *  Union with the removed set, so a project on an older interpreter is
 *  not accused of depending on `distutils`. */
export const PYTHON_STDLIB = new Set([
  ...PYTHON_STDLIB_CURRENT,
  ...PYTHON_STDLIB_REMOVED,
]);

// ── TypeScript / JavaScript ──────────────────────────────────────────
// Keyed by PACKAGE name (bare specifier's first segment, or the first two
// for an @scope/name).
//
// next / astro are meta-frameworks: PLAN-M-STACK lists them under BOTH
// web-framework and frontend. One tool gets ONE role, so they are
// classified `frontend` — "is the frontend Next.js / React / Astro" is
// the question the role has to answer; their server halves show up as
// route entry points in the IR anyway.

export const JSTS_TOOLS: Record<string, StackRole> = {
  express: "web-framework", fastify: "web-framework", koa: "web-framework",
  hapi: "web-framework", "@nestjs/core": "web-framework",
  react: "frontend", vue: "frontend", svelte: "frontend", preact: "frontend",
  next: "frontend", astro: "frontend", "@remix-run/react": "frontend",
  axios: "http-client", "node-fetch": "http-client", undici: "http-client",
  got: "http-client", "cross-fetch": "http-client",
  pg: "db", prisma: "db", "@prisma/client": "db", knex: "db",
  mongoose: "db", mongodb: "db", "better-sqlite3": "db", mysql2: "db",
  typeorm: "db", drizzle: "db",
  ioredis: "cache", redis: "cache",
  bullmq: "queue", bull: "queue", amqplib: "queue",
  "aws-sdk": "cloud", "@aws-sdk/client-s3": "cloud", "@google-cloud/storage": "cloud",
  vitest: "test", jest: "test", "@jest/globals": "test", mocha: "test",
  "@playwright/test": "test", chai: "test",
  vite: "build", webpack: "build", esbuild: "build", rollup: "build",
  typescript: "build",
  // M-CMD.3 — in-process libraries (see StackRole `utility`): the first
  // members are what the classify pass met on a real codebase and a
  // maintainer promoted, the stack_learn loop run by hand once.
  zod: "utility", yup: "utility", joi: "utility", uuid: "utility", nanoid: "utility",
  "date-fns": "utility", dayjs: "utility", moment: "utility", luxon: "utility",
  lodash: "utility", "lodash-es": "utility", ramda: "utility",
  cheerio: "utility", jsdom: "utility", "json-stable-stringify": "utility", json5: "utility",
  "p-queue": "utility", "p-limit": "utility", eventemitter2: "utility", eventemitter3: "utility",
  "pdf-parse": "utility",
  // M-CMD.3 — backend platform SDKs (see StackRole `platform`).
  firebase: "platform", "@supabase/supabase-js": "platform", appwrite: "platform",
  pocketbase: "platform", parse: "platform",
  // TDX Volt (docs.tdxvolt.com): a peer-to-peer platform where a Volt is
  // the unit of identity and trust (own key, CA, policy, database) and a
  // client runs unary/streaming calls under the caller's identity. The
  // scope family below classifies the client packages; `wires` is named
  // EXACTLY because a wire is a publish/subscribe stream resource, which
  // is `queue`, and an exact entry wins over its scope.
  "@tdxvolt/wires": "queue",
  // gRPC over HTTP/2: a stub call is a network round trip, the same
  // boundary as an HTTP client (it also hosts servers; the role names the
  // call side, which is what a thread reaches).
  "@grpc/grpc-js": "http-client",
  // Lint and icon libraries, formerly `unknown` on a real codebase (46 and
  // 79 files): named so the unclassified list says only what it means.
  eslint: "build", "@eslint/eslintrc": "build", "@eslint/js": "build",
  "lucide-react": "frontend", "@phosphor-icons/react": "frontend", "react-icons": "frontend",
  // M-CMD.2 — hosted-model clients and agent-protocol SDKs (see StackRole).
  // A subpath specifier keys on the package: jstsPackageName turns
  // `@modelcontextprotocol/sdk/server/mcp.js` into `@modelcontextprotocol/sdk`.
  openai: "model-api", "@anthropic-ai/sdk": "model-api",
  "@anthropic-ai/claude-agent-sdk": "model-api",
  "@google/generative-ai": "model-api", "@google/genai": "model-api",
  "cohere-ai": "model-api", "@mistralai/mistralai": "model-api",
  "groq-sdk": "model-api", ollama: "model-api", "@huggingface/inference": "model-api",
  replicate: "model-api", "together-ai": "model-api",
  ai: "model-api", "@ai-sdk/openai": "model-api", "@ai-sdk/anthropic": "model-api",
  "@ai-sdk/google": "model-api",
  langchain: "model-api", "@langchain/core": "model-api",
  "@langchain/openai": "model-api", "@langchain/anthropic": "model-api",
  "@modelcontextprotocol/sdk": "agent-protocol", fastmcp: "agent-protocol",
};

/** M-CMD.2 — a SCOPED FAMILY classified by its scope. `@aws-sdk/*` has
 *  hundreds of members, and a table naming one of them (`client-s3`) left
 *  `@aws-sdk/credential-provider-cognito-identity` unclassified on a real
 *  codebase — the class-vs-member gap the two new roles closed, one level
 *  up. An exact JSTS_TOOLS entry wins; this answers for the rest of the
 *  family. SCOPES only: a scope is a publisher's namespace, which is
 *  evidence about every member, where a bare-name prefix would be a guess.
 *  A scope whose members straddle roles (`@azure/*` holds auth libraries
 *  beside cloud SDKs) is left out rather than half-right. */
export const JSTS_SCOPE_TOOLS: Record<string, StackRole> = {
  "@aws-sdk": "cloud", "@google-cloud": "cloud",
  "@ai-sdk": "model-api", "@langchain": "model-api", "@anthropic-ai": "model-api",
  "@modelcontextprotocol": "agent-protocol",
  // M-CMD.3 — platform SDK families. `@tdxvolt/*`: volt-client (the client
  // core), volt-client-web (WebSocket), volt-client-grpc (gRPC), volt-utility
  // (identity helpers) — one platform, four packages, and `wires` above is
  // the one member with a role of its own.
  "@tdxvolt": "platform", "@firebase": "platform", "@supabase": "platform",
  "@eslint": "build", "@phosphor-icons": "frontend",
};

/** M-CMD.3 — DEFINITIONS for tools whose role alone under-describes them.
 *  One line, from the vendor's documentation and the usage that put them
 *  here; rendered by the system spec under "Definitions" so a reader knows
 *  what the boundary IS, not just which role bucket it fell in. A note is
 *  documentation, never evidence: it classifies nothing (the tables do)
 *  and derives nothing (the roles do). Keyed by exact tool name, with a
 *  scope-level fallback for a family's other members. */
export const TOOL_NOTES: Record<string, string> = {
  "@tdxvolt/volt-client-web": "TDX Volt browser client (WebSocket, mapped to the gRPC streaming modes): connects to a Volt — the unit of identity and trust, with its own key, CA, policy and SQLite database — through the tdxvolt.com relay and runs unary/streaming calls under the caller's own identity; CommandStream runs an allow-listed command on the Volt's host, DB calls query the Volt's database.",
  "@tdxvolt/volt-client-grpc": "TDX Volt Node.js client over gRPC (@grpc/grpc-js is the transport; initialise() takes a config-file path): the same Volt API as the web client, from a server-side process.",
  "@tdxvolt/volt-client": "TDX Volt client core: the VoltClient types and API surface the web and gRPC packages implement.",
  "@tdxvolt/volt-utility": "TDX Volt identity helpers (requestEmailVerification, checkEmailVerificationStatus): the email-verification flow that binds a verifiable credential to a browser-minted key via the Volt's SSI service.",
  "@tdxvolt/wires": "TDX Volt wires client: a wire is a Volt resource carrying opaque publish/subscribe streams (raw binary by default), gated by the volt:resource-publish / volt:resource-subscribe permissions.",
  "@tdxvolt": "TDX Volt (docs.tdxvolt.com): a peer-to-peer, decentralised platform. A Volt holds its own key, certificate authority, XACML-style attribute policy and database; a Battery process hosts Volts; a relay tunnels for Volts behind NAT without seeing payloads; policy is enforced by the TARGET Volt, never the relay.",
  "@grpc/grpc-js": "gRPC for Node over HTTP/2: stub calls are network round trips; the same package hosts gRPC servers.",
};

/** The definition for a tool, or its scope family's, or nothing. */
export function toolNote(tool: string): string | undefined {
  if (TOOL_NOTES[tool]) return TOOL_NOTES[tool];
  const scope = tool.startsWith("@") ? tool.split("/")[0] : "";
  return scope ? TOOL_NOTES[scope] : undefined;
}

/** M-BOUNDARY.1 - JS/TS GLOBALS that are a real tool with a role. No
 *  import declares them, so before M-BOUNDARY the index could not answer
 *  "what HTTP client does this gateway use?" for a codebase that calls
 *  `fetch` - the same class of evidence as a bash command word (a CALL
 *  node whose name IS the tool), and read the same way. */
export const JSTS_GLOBAL_TOOLS: Record<string, StackRole> = {
  fetch: "http-client",
  XMLHttpRequest: "http-client",
  WebSocket: "remote",
};

/** Node builtins (with or without the `node:` prefix), GENERATED from
 *  `module.builtinModules` (M-TABLES). */
export const NODE_BUILTINS = new Set(NODE_BUILTIN_NAMES);

/** Config-file evidence (M-LANG3 limit: .js/.jsx are not parsed, so for an
 *  unparsed web frontend these files are the ONLY facts — and they are
 *  labelled `evidence: "config"` wherever they are rendered). */
export const CONFIG_TOOLS: Array<{ match: RegExp; tool: string; role: StackRole }> = [
  { match: /^next\.config\.(m?[jt]s|cjs)$/, tool: "next", role: "frontend" },
  { match: /^astro\.config\.(m?[jt]s|cjs)$/, tool: "astro", role: "frontend" },
  { match: /^vite\.config\.(m?[jt]s|cjs)$/, tool: "vite", role: "build" },
  { match: /^svelte\.config\.(m?[jt]s|cjs)$/, tool: "svelte", role: "frontend" },
  { match: /^nuxt\.config\.(m?[jt]s|cjs)$/, tool: "nuxt", role: "frontend" },
  { match: /^tailwind\.config\.(m?[jt]s|cjs)$/, tool: "tailwindcss", role: "frontend" },
  { match: /^docker-compose\.ya?ml$/, tool: "docker-compose", role: "infra" },
  { match: /^Dockerfile$/, tool: "docker", role: "infra" },
];

// ── bash ─────────────────────────────────────────────────────────────
// Command WORDS on call nodes. A call that resolves to a project function
// (a `reference` edge) is never a tool; a shell builtin is never a tool.

export const BASH_TOOLS: Record<string, StackRole> = {
  curl: "http-client", wget: "http-client", http: "http-client",
  psql: "db", mysql: "db", sqlite3: "db", pg_dump: "db", mysqldump: "db",
  mongo: "db", redis_cli: "cache", "redis-cli": "cache",
  aws: "cloud", gcloud: "cloud", gsutil: "cloud", az: "cloud",
  docker: "infra", "docker-compose": "infra", kubectl: "infra",
  terraform: "infra", helm: "infra", systemctl: "infra",
  ssh: "remote", scp: "remote", rsync: "remote", sftp: "remote",
  make: "build", npm: "build", pip: "build", pip3: "build", yarn: "build",
  pnpm: "build", cargo: "build", go: "build", gradle: "build", mvn: "build",
  python: "runtime", python3: "runtime", node: "runtime", bash: "runtime", sh: "runtime",
  // M-CMD.2 — a shell that runs a model is at the same boundary as code that
  // calls one: `ollama` serves/runs a local model, `claude` is the CLI that
  // spawns a hosted one (this repository's own scripts do exactly that).
  ollama: "model-api", claude: "model-api",
  // M-CMD.3 — platform CLIs: a deploy or a query against the platform.
  firebase: "platform", supabase: "platform",
  // M-CMD.3 — `jq` transforms JSON on stdin: data work, not plumbing.
  jq: "data",
};

/** M-TABLES — the shell's OWN builtins, GENERATED from `compgen -b`. The
 *  hand-written list conflated these with coreutils: of its 60 entries only
 *  26 were builtins, 34 were external binaries, and 35 real builtins were
 *  missing. They are different facts — `cd` is the shell, `sed` is a
 *  program on PATH — so they are now separate lists. */
export const BASH_SHELL_BUILTINS = new Set(BASH_SHELL_BUILTIN_NAMES);

/** The shell's reserved words, GENERATED from `compgen -k`. A keyword is
 *  parsed, not run — `[[` is not a program the deploy host needs. */
export const BASH_KEYWORDS = new Set(BASH_KEYWORD_NAMES);

/** Coreutils plumbing: external binaries present in every script, telling
 *  you nothing about the stack. Hand-curated ON PURPOSE — this is a
 *  judgement about what is ambient, not an enumeration of anything, and no
 *  command can be asked for it. */
export const BASH_COREUTILS = new Set([
  "cat", "cut", "sed", "awk", "grep", "tr", "sort", "uniq", "head", "tail",
  "wc", "date", "sleep", "mkdir", "rm", "mv", "cp", "ln", "touch", "chmod",
  "chown", "find", "xargs", "tee", "dirname", "basename", "ls", "env",
  "logger", "mktemp", "seq", "tar", "gzip",
  // M-CMD.3 — the rest of the GNU coreutils PROGRAM list (the documented
  // set, minus the names that are also shell builtins: echo, printf, pwd,
  // test, kill, true, false — those are the shell's, above). Six of these
  // (`base64`, `md5sum`, `paste`, `readlink`, `timeout`, `cksum`) read as
  // unclassified third-party on the first real codebase. Still a judgement
  // about what is AMBIENT, not a probe of any machine (M-TABLES).
  "base64", "base32", "chgrp", "cksum", "comm", "csplit", "dd", "df", "du",
  "expand", "expr", "factor", "fmt", "fold", "hostname", "id", "install",
  "join", "link", "logname", "md5sum", "mkfifo", "mknod", "nice", "nl",
  "nohup", "nproc", "numfmt", "od", "paste", "pathchk", "pr", "printenv",
  "ptx", "readlink", "realpath", "rmdir", "sha1sum", "sha224sum",
  "sha256sum", "sha384sum", "sha512sum", "shred", "shuf", "split", "stat",
  "stty", "sum", "sync", "tac", "timeout", "truncate", "tsort", "tty",
  "uname", "unexpand", "unlink", "users", "vdir", "who", "whoami", "yes",
]);

/** What a stack reading skips before the unknown fallback: the shell itself
 *  plus its ambient plumbing. Unchanged in meaning for every caller. */
export const BASH_BUILTINS = new Set([
  ...BASH_SHELL_BUILTINS, ...BASH_KEYWORDS, ...BASH_COREUTILS,
]);

// ── C++ ──────────────────────────────────────────────────────────────
// Include paths, angle brackets stripped.

export const CPP_TOOLS: Record<string, StackRole> = {
  "curl/curl.h": "http-client", "cpr/cpr.h": "http-client",
  "sqlite3.h": "db", "pqxx/pqxx": "db", "mysql/mysql.h": "db",
  "hiredis/hiredis.h": "cache",
  "torch/torch.h": "tensor", "ATen/ATen.h": "tensor",
  "Eigen/Dense": "data",
  "gtest/gtest.h": "test", "gmock/gmock.h": "test", "catch2/catch.hpp": "test",
  "boost/asio.hpp": "runtime",
};

/** The C++ standard library headers are conventionally extension-less
 *  (`<vector>`) or `c`-prefixed (`<cstdio>`); everything else in angle
 *  brackets is a third-party dependency this project does not vendor. */
export function isCppStdHeader(header: string): boolean {
  return !header.includes("/") && (!header.includes(".") || /^c[a-z]+$/.test(header));
}

// ── rust (M-RUST.4) ──────────────────────────────────────────────────
// Keyed by CRATE ROOT — the first `::` segment of a use path, which is
// what Cargo publishes and what a dependency line names. Crate roots use
// `_`, so the package `actix-web` is the root `actix_web`.
export const RUST_TOOLS: Record<string, StackRole> = {
  reqwest: "http-client", ureq: "http-client", hyper: "http-client",
  isahc: "http-client", surf: "http-client",
  axum: "web-framework", actix_web: "web-framework", rocket: "web-framework",
  warp: "web-framework", tide: "web-framework", poem: "web-framework",
  rusqlite: "db", sqlx: "db", diesel: "db", sea_orm: "db",
  postgres: "db", tokio_postgres: "db", mongodb: "db",
  redis: "cache",
  lapin: "queue", rdkafka: "queue", amqprs: "queue",
  tokio: "runtime", async_std: "runtime", smol: "runtime",
  serde: "data", serde_json: "data", serde_yaml: "data", toml: "data",
  csv: "data", polars: "data", ndarray: "data", arrow: "data",
  tch: "tensor", candle_core: "tensor", burn: "tensor",
  aws_config: "cloud",
  // Python classes `logging` as runtime (it falls through to the stdlib
  // branch); Rust's loggers are crates, so they keep the ROLE and take
  // their origin from the manifest like any other dependency.
  log: "runtime", tracing: "runtime", env_logger: "runtime",
  clap: "runtime", structopt: "runtime",
  anyhow: "runtime", thiserror: "runtime",
  criterion: "test", proptest: "test",
};

/**
 * Rust's standard library is THREE crate roots, and that is the whole
 * list — fixed by the language, not by a runtime we could ask.
 *
 * Worth saying beside `isCppStdHeader`, which looks similar and is not:
 * that one is a CONVENTION (extension-less or `c`-prefixed headers) and
 * can be wrong at the edges. This one is complete by definition, so
 * `third-party` for anything else is a sound claim rather than the shrug
 * M-TABLES had to replace with `unknown` for bash.
 */
export function isRustStd(root: string): boolean {
  return root === "std" || root === "core" || root === "alloc";
}

/** A `use` path's crate ROOT. `crate` / `self` / `super` are this
 *  project's own modules, so they name no external tool at all. */
export function rustCrateName(spec: string): string | null {
  const root = String(spec ?? "").split("::")[0]?.trim();
  if (!root) return null;
  if (root === "crate" || root === "self" || root === "super") return null;
  return root;
}

// M-RESOLVE.2 — RUNTIME CALLS: a bare name that IS the language's own
// runtime, not an unknown receiver. `open`, `fopen` and `echo` were the
// three largest remaining "unresolved" shapes in the real fixtures, and
// none of them is a mystery — they are the standard library, called
// directly.
//
// The value is honesty about the denominator: with these attributed,
// "unattributed" finally means genuinely unknown rather than "we never
// had a table for the obvious".
//
// C++ is evidence-gated: a name maps to a header, and the attribution
// only fires when the file actually INCLUDES that header. That keeps the
// M-LANG5a floor (no build graph, no guessing which TU owns a symbol) —
// the include is the evidence, exactly as an import is elsewhere.
export const PYTHON_RUNTIME_CALLS: Record<string, string> = {
  open: "builtins", print: "builtins", input: "builtins",
};

export const CPP_RUNTIME_CALLS: Record<string, string> = {
  fopen: "cstdio", fclose: "cstdio", fread: "cstdio", fwrite: "cstdio",
  fprintf: "cstdio", printf: "cstdio", sprintf: "cstdio", snprintf: "cstdio",
  fgets: "cstdio", fputs: "cstdio", puts: "cstdio", fscanf: "cstdio",
  perror: "cstdio", remove: "cstdio", rename: "cstdio",
  malloc: "cstdlib", calloc: "cstdlib", realloc: "cstdlib", free: "cstdlib",
  exit: "cstdlib", abort: "cstdlib", system: "cstdlib", getenv: "cstdlib",
  memcpy: "cstring", memset: "cstring", memmove: "cstring", memcmp: "cstring",
  strlen: "cstring", strcmp: "cstring", strcpy: "cstring", strncpy: "cstring",
};

/** M-RESOLVE.4 — JS runtime namespaces reached through a GLOBAL, where the
 *  call is effectful so it really is a boundary. `console.log` writes to
 *  stdout; no import declares `console`, and the label is dotted, so
 *  neither the bare-name runtime rule nor the not-a-boundary rule sees it.
 *
 *  Deliberately NOT in JSTS_GLOBAL_TOOLS: that table feeds the stack INDEX,
 *  and "this project's tools include console" is noise, not architecture.
 *  Same standing as PYTHON_RUNTIME_CALLS' `builtins` and bash's `shell` —
 *  it names the boundary without claiming a dependency. */
export const JSTS_RUNTIME_CALLS: Record<string, string> = {
  console: "console",
  process: "process",
};

/** bash: the shell's own builtins and coreutils. BASH_BUILTINS already
 *  names them; this is the tool they belong to when one carries an
 *  effect (`echo` and `logger` are `log` writes). */
export const BASH_RUNTIME_TOOL = "shell";

/** M-RUST.4 — the std MACROS that write somewhere a person reads. They
 *  carry their `!` in the label, because that is how the parser stamps
 *  them and how a reader recognises one. Same standing as
 *  PYTHON_RUNTIME_CALLS' `builtins`: it names the boundary without
 *  claiming a dependency, so `std` never appears as a project "tool". */
export const RUST_RUNTIME_CALLS: Record<string, string> = {
  "println!": "std", "eprintln!": "std", "print!": "std",
  "eprint!": "std", "dbg!": "std",
};

// M-RESOLVE.3 — FRAMEWORK HANDLER PARAMETERS. A route handler's leading
// parameters are the framework's own objects, by that framework's
// documented convention: express hands `(req, res, next)`, fastify
// `(request, reply)`, koa `(ctx)`. So `res.json(...)` inside an express
// handler is an express call, and the IR already knows every part of
// that — the entry point records the framework, and the function node
// records its parameter names.
//
// POSITION, not name: a handler written `(_, res)` is still express, and
// a local called `res` in an unrelated function is still not.
export const FRAMEWORK_HANDLER_PARAMS: Record<string, number> = {
  express: 3,   // (req, res, next)
  fastify: 2,   // (request, reply)
  koa: 1,       // (ctx)
  hapi: 2,      // (request, h)
};

// ── lookups ──────────────────────────────────────────────────────────

/** Tool names ride prompts, constraint scopes, and the wire. Printable,
 *  bounded, no whitespace; `@` and `/` allowed for npm scopes and C++
 *  include paths. */
export function isSafeToolName(v: unknown): v is string {
  return typeof v === "string" && /^[@A-Za-z0-9][@A-Za-z0-9._\-\/+]{0,119}$/.test(v);
}

/** 2026-09-24 — `@azure/*` straddles roles, so the scope is not a family
 *  (JSTS_SCOPE_TOOLS). A member that names an Azure DATA service by the
 *  provider's convention (`@azure/storage-blob`, `@azure/cosmos`,
 *  `@azure/service-bus`) is cloud; `@azure/identity`, `@azure/msal-*` and
 *  anything the convention does not recognise stay unclassified. */
function azureDataService(tool: string): StackRole | undefined {
  if (!tool.startsWith("@azure/")) return undefined;
  const svc = cloudServiceOf(tool);
  return svc && svc.kind !== "auth" && svc.kind !== "other" ? "cloud" : undefined;
}

/** Python import specifier → the tool name the index keys on (the root,
 *  or the two-segment form for the entries that need it). */
export function pythonToolName(spec: string): string {
  const parts = spec.split(".");
  const two = parts.slice(0, 2).join(".");
  if (PYTHON_TOOLS[two]) return two;
  return parts[0] ?? spec;
}

/** TS/JS bare specifier → package name (@scope/name keeps two segments). */
export function jstsPackageName(spec: string): string {
  const bare = spec.startsWith("node:") ? spec.slice(5) : spec;
  const parts = bare.split("/");
  if (bare.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0] ?? bare;
}

/** (role, origin) for a tool name in a language. `null` language means
 *  "already normalised" — callers pass the registry id. */
export function classifyTool(language: string, tool: string): { role: StackRole; origin: StackOrigin } {
  switch (language) {
    case "python": {
      const role = PYTHON_TOOLS[tool];
      const stdlib = PYTHON_STDLIB.has(tool.split(".")[0]);
      return { role: role ?? (stdlib ? "runtime" : "unknown"), origin: stdlib ? "stdlib" : "third-party" };
    }
    case "jsts": {
      // M-CMD.2 — exact name, then a global, then the package's SCOPE family.
      const scope = tool.startsWith("@") ? tool.split("/")[0] : "";
      const role = JSTS_TOOLS[tool] ?? JSTS_GLOBAL_TOOLS[tool] ?? (scope ? JSTS_SCOPE_TOOLS[scope] : undefined)
        ?? azureDataService(tool);
      const stdlib = NODE_BUILTINS.has(tool) || !!JSTS_GLOBAL_TOOLS[tool];
      return { role: role ?? (stdlib ? "runtime" : "unknown"), origin: stdlib ? "stdlib" : "third-party" };
    }
    case "bash": {
      // A named tool IS a third-party dependency (`curl`, `docker`, `aws`
      // must be installed). A builtin is the shell itself. Anything else is
      // a word on PATH, and nothing here can say whose — `command -v` would
      // answer for the machine doing the parsing, not the deploy host.
      const role = BASH_TOOLS[tool];
      if (role) return { role, origin: "third-party" };
      if (BASH_BUILTINS.has(tool)) return { role: "runtime", origin: "stdlib" };
      return { role: "unknown", origin: "unknown" };
    }
    case "cpp": {
      const role = CPP_TOOLS[tool];
      const stdlib = isCppStdHeader(tool);
      return { role: role ?? (stdlib ? "runtime" : "unknown"), origin: stdlib ? "stdlib" : "third-party" };
    }
    case "rust": {
      // std/core/alloc is the complete standard library, so that half is
      // certain. For the rest, a TABLE ENTRY is evidence the crate exists
      // off-tree — someone wrote it down — while an unrecognised root is
      // not: it may be a dependency, or a module this reader cannot see.
      // So an unknown root is `unknown`, the M-TABLES rule, and the STACK
      // INDEX upgrades it to `third-party` when Cargo.toml declares it.
      if (isRustStd(tool)) return { role: "runtime", origin: "stdlib" };
      const role = RUST_TOOLS[tool];
      if (role) return { role, origin: "third-party" };
      // `aws_sdk_s3`, `aws_sdk_dynamodb`, … — one family, many crates.
      if (tool.startsWith("aws_sdk_")) return { role: "cloud", origin: "third-party" };
      return { role: "unknown", origin: "unknown" };
    }
    default:
      // A language with no evidence table. Claiming `third-party` here
      // would invent a dependency out of having no table at all.
      return { role: "unknown", origin: "unknown" };
  }
}
