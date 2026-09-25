// M-ARCH.1 (PLAN-M-ARCH.md) — what crosses an architecture edge, read from
// the FACTS the stack and the hops already hold, never from a model.
//
// Archify's edges carry a protocol ("HTTPS", "mTLS", "gRPC", "SQL") that the
// agent writing the diagram types from memory. Ours is derived: an edge to a
// tool gets the protocol of the tool's ROLE (with a table for the members
// whose role under-says it — a Volt web client is a WebSocket to the relay,
// its Node client is gRPC), a hop gets its KIND's protocol, and a tool no
// table knows says `unknown` with the reason. Every answer carries `basis`,
// the sentence a reader checks it against.
//
// Webview-safe: pure data + pure functions (the stack_taxonomy precedent),
// so the System view's legend and the server's model read one table.

export interface ProtocolAnswer {
  protocol: string;
  /** why this protocol — the fact it was read from. */
  basis: string;
  /** the carrier is a PRESENCE claim (imported, not seen called); the view
   *  draws the label as the weaker claim it is. */
  presence?: true;
}

/** Legend categories, in render order. A category is what a reader scans
 *  for; it maps to the three accent families in the view. */
export type ArchCategory =
  | "frontend" | "backend" | "scripts" | "agent" | "pipeline"
  | "platform" | "database" | "cache" | "storage" | "queue" | "model" | "cloud" | "external" | "unknown";

export const ARCH_CATEGORIES: readonly ArchCategory[] = [
  "frontend", "backend", "scripts", "agent", "pipeline",
  "platform", "database", "cache", "storage", "queue", "model", "cloud", "external", "unknown",
];

export const ARCH_CATEGORY_LABEL: Record<ArchCategory, string> = {
  frontend: "web app",
  backend: "backend",
  scripts: "scripts",
  agent: "agent protocol",
  pipeline: "pipeline / CLI",
  platform: "platform",
  database: "database",
  cache: "cache",
  storage: "file store",
  queue: "message bus",
  model: "model API",
  cloud: "cloud",
  external: "external",
  unknown: "unclassified",
};

/** Stack roles that ARE architecture boundaries: a call through one leaves
 *  the process for something else. The others (runtime, utility, frontend,
 *  build, test, data, tensor, web-framework, process) are how a process is
 *  written, not what it talks to. `unknown` is kept: an unclassified tool a
 *  thread CALLS is a boundary of unknown kind, and hiding it would be the
 *  silent gap principle 12 refuses. */
export const BOUNDARY_ROLES: ReadonlySet<string> = new Set([
  "db", "cache", "queue", "platform", "model-api", "http-client",
  "agent-protocol", "cloud", "remote", "unknown",
]);

export const ROLE_CATEGORY: Record<string, ArchCategory> = {
  db: "database", cache: "cache", queue: "queue", platform: "platform",
  "model-api": "model", "http-client": "external", "agent-protocol": "agent",
  cloud: "cloud", remote: "external", unknown: "unknown",
};

const SQL_TOOLS = new Set([
  "pg", "postgres", "psql", "pg_dump", "mysql", "mysql2", "mysqldump", "sqlite3", "better-sqlite3",
  "sqlalchemy", "psycopg", "psycopg2", "asyncpg", "prisma", "@prisma/client", "knex", "drizzle-orm",
  "sequelize", "typeorm", "duckdb", "pymysql", "aiosqlite", "rusqlite", "sqlx", "diesel",
]);
const MONGO_TOOLS = new Set(["mongodb", "mongoose", "pymongo", "motor", "mongo"]);
const REDIS_TOOLS = new Set(["redis", "ioredis", "redis-cli", "redis_cli", "aioredis"]);

/** Members whose role under-says the wire. Sourced from the vendor docs the
 *  taxonomy's TOOL_NOTES cite (docs.tdxvolt.com for the Volt clients). */
const TOOL_WIRE: Record<string, string> = {
  "@tdxvolt/volt-client-web": "Volt · WebSocket",
  "@tdxvolt/volt-client-grpc": "Volt · gRPC",
  "@tdxvolt/volt-client": "Volt",
  "@tdxvolt/volt-utility": "Volt · identity",
  "@tdxvolt/wires": "Volt wire · pub/sub",
  "@grpc/grpc-js": "gRPC",
  grpcio: "gRPC",
  firebase: "Firebase · HTTPS",
  "@supabase/supabase-js": "Supabase · HTTPS",
  kafkajs: "Kafka",
  "kafka-python": "Kafka",
  amqplib: "AMQP",
  pika: "AMQP",
  nats: "NATS",
};

/** The protocol an edge INTO a tool carries. */
export function toolProtocol(tool: string, role: string): ProtocolAnswer {
  if (TOOL_WIRE[tool]) return { protocol: TOOL_WIRE[tool], basis: `${tool}: the vendor's documented transport` };
  switch (role) {
    case "db":
      if (SQL_TOOLS.has(tool)) return { protocol: "SQL", basis: `${tool} is a SQL client (role db)` };
      if (MONGO_TOOLS.has(tool)) return { protocol: "MongoDB wire", basis: `${tool} is a MongoDB client (role db)` };
      if (REDIS_TOOLS.has(tool)) return { protocol: "RESP", basis: `${tool} is a Redis client (role db)` };
      return { protocol: "db", basis: `${tool} has role db; its wire protocol is not in the table` };
    case "cache":
      if (REDIS_TOOLS.has(tool)) return { protocol: "RESP", basis: `${tool} is a Redis client (role cache)` };
      return { protocol: "cache", basis: `${tool} has role cache` };
    case "queue": return { protocol: "pub/sub", basis: `${tool} has role queue` };
    case "platform": return { protocol: "platform API", basis: `${tool} has role platform; its transport is not in the table` };
    case "model-api": return { protocol: "HTTPS · model API", basis: `${tool} is a hosted-model client (role model-api)` };
    case "http-client": return { protocol: "HTTP", basis: `${tool} is an HTTP client` };
    case "agent-protocol": return { protocol: "MCP", basis: `${tool} speaks the Model Context Protocol` };
    case "cloud": return { protocol: "HTTPS · cloud API", basis: `${tool} is a cloud SDK` };
    case "remote": return { protocol: /^(ssh|scp|sftp|rsync|paramiko|fabric)$/.test(tool) ? "SSH" : "remote", basis: `${tool} has role remote` };
    default: return { protocol: "unknown", basis: `${tool} has no role a table or a person has given it (classify it, or state its role)` };
  }
}

/** The carrier of a `command` hop: the tool that actually runs the script.
 *  `carrier` is a platform tool the source thread calls or whose files
 *  import it; absent, a bash/node thread execs, and anything else is a
 *  command whose transport the IR does not show. */
/** Platform packages that cannot run a command: identity helpers and a
 *  pub/sub client. Never a command hop's carrier, however present. */
export const NON_CARRIERS: ReadonlySet<string> = new Set(["@tdxvolt/volt-utility", "@tdxvolt/wires"]);

/** Tools that run a program as a subprocess: a command hop through one is `exec`. */
export const EXEC_TOOLS: ReadonlySet<string> = new Set([
  "child_process", "node:child_process", "subprocess", "execa", "shelljs", "zx", "cross-spawn",
]);

export function commandProtocol(
  carrier: { tool: string; role: string; how: "called" | "present" | "cluster"; via?: string } | null,
  sourceLanguage: string,
): ProtocolAnswer {
  if (carrier && (carrier.role === "process" || EXEC_TOOLS.has(carrier.tool))) {
    return { protocol: "exec", basis: `the source thread spawns the named script through ${carrier.tool}` };
  }
  if (carrier && carrier.how === "cluster") {
    const wire = TOOL_WIRE[carrier.tool] ?? toolProtocol(carrier.tool, carrier.role).protocol;
    return {
      protocol: `${wire} · command`,
      basis: `${carrier.tool} is the only platform client this cluster imports; the call that carries the command takes the client as a value and is not attributed, so the carrier is a cluster-level presence claim`,
      presence: true,
    };
  }
  if (carrier) {
    const wire = TOOL_WIRE[carrier.tool] ?? toolProtocol(carrier.tool, carrier.role).protocol;
    return {
      protocol: `${wire} · command`,
      basis: carrier.how === "called"
        ? `the source thread calls ${carrier.tool}, which carries the command`
        : `${carrier.tool} is imported by the source thread's files${carrier.via ? ` (through the project funnel ${carrier.via})` : ""}; the call that carries the command is not attributed, so the carrier is a presence claim`,
      ...(carrier.how === "called" ? {} : { presence: true as const }),
    };
  }
  if (sourceLanguage === "bash") return { protocol: "exec", basis: "a shell script runs the named script as a subprocess" };
  return { protocol: "command", basis: "a script is named by a literal; what runs it is not attributed" };
}
