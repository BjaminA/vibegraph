// THE DATA ARCHITECTURE DERIVED FROM CODE (2026-10-02). On a shared data
// platform the architecture that matters is DATA (catalogue tables, transition
// tables, decision trees) and COMPUTED NAMES (resource names built by small
// functions), reached through an SDK whose method names carry the effect, and
// coupled through documents rather than calls. This is what VibeGraph can read
// of it from the IR alone, zero tokens: every item cites where it came from,
// and what could not be reduced is said, never guessed.
//
// It is a DERIVED layer. A project's own topology generator (DECLARED) wins
// wherever both speak, and the person's statements stay apart. Webview-safe.

import type { Topology } from "./topology_types.ts";

/** A module-level literal table as the parser lifted it (IR `table`). */
export type TableValue = string | number | boolean | null | TableValue[]
  | { ref: string } | { fields: Record<string, TableValue> } | { fn: number } | { spread: unknown } | { expr: string };
export interface TableRow { key?: string; line: number; fields?: Record<string, TableValue>; value?: TableValue }
export interface LiteralTable { shape: "rows" | "record" | "list"; rows?: TableRow[]; values?: TableValue[]; exported?: boolean; truncated?: number }
/** One table, where it lives. */
export interface TableDecl { file: string; name: string; line: number; table: LiteralTable }

/** A name built by a small pure function, as a pattern with typed holes. */
export interface NamePattern {
  /** `{env}.invoices.{tenantId}`; holes are the function's parameter names */
  pattern: string;
  /** the function that builds it */
  fn: string;
  file: string;
  line: number;
}

/** What a call to a tool's method does, from the verb in its name. */
export type SdkEffect = "read" | "write" | "admin" | "watch" | "grant" | "call";

export interface SdkCall {
  file: string;
  line: number;
  /** as written: `client.SaveAccess`, `s3.put_object` */
  callee: string;
  method: string;
  tool: string;
  /** how the receiver was tied to the tool */
  how: string;
  effect: SdkEffect;
  /** the payload KEYS (never values) */
  keys?: string[];
  /** the resource name its arguments reduce to */
  name?: string;
  /** when the name could not be reduced: where it is computed */
  computedAt?: string;
  /** in a test file */
  test?: boolean;
}

export interface Injection {
  /** the interface (or protocol) the parameter is typed by */
  iface: string;
  property: string;
  /** every call site through the parameter */
  calls: Array<{ file: string; line: number; callee: string }>;
  /** `structural`: a class with every required member, not declared as implementing it (the class name) */
  implementations: Array<{ file: string; line: number; fn: string; test: boolean; structural?: string }>;
}

/** A process writes a family that another process watches or reads. */
export interface DataHop {
  family: string;
  from: { op: "write"; file: string; line: number; entries: string[] };
  to: { op: "watch" | "read"; file: string; line: number; entries: string[] };
  note: string;
}

export interface DataArchitecture {
  version: "1";
  tables: Array<{ file: string; name: string; line: number; shape: string; rows: number; fields: string[] }>;
  namePatterns: NamePattern[];
  /** M2: the builder that names each zone's resource from configuration (`{ALIAS=ngt}-{boundary}`) */
  resourceNaming?: { fn: string; file: string; line: number; pattern: string; zoneHole: string; chain?: string; cite: string };
  sdkCalls: SdkCall[];
  injections: Injection[];
  /** stores, zones, families, grants, state machines, decision trees */
  topology: Topology;
  flows: DataHop[];
  /** writers the code's own grant function changes after reading the catalogue (M3) */
  writerOverrides?: string[];
  /** every data operation the derivation placed: a write / read / watch of a family, where, by which processes */
  operations: Array<{ file: string; line: number; op: "write" | "read" | "watch"; family: string; via?: string[]; port?: string; entries: string[] }>;
  /** what could not be reduced, and where: never a pass */
  computed: string[];
}
