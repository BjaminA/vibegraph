// Where the code TOUCHES a planned store (2026-10-01). A store is reached
// through access functions the plan names (`access: {write, read, watch}` —
// the client's own API, `writeDoc`, `watchDocs`), and a call to one of them
// whose LITERAL arguments name a zone or a document family is an access site:
// "apps/decider/src/main.ts:8, onRequest WRITES verdicts/verdict".
//
// One function answers it for every plan check that needs it: a zone the
// routing names (Module 2), the principal × zone write matrix (Module 3), an
// indirect hop through the store (Module 4) and single-writer (Module 7).
//
// Read from the IR's call nodes and their literal arguments, never from source
// text, and never guessed past them: a call whose zone is COMPUTED (a
// variable, a template with `${…}`) is a site with no zone, said as one, so a
// check can answer "unverifiable" instead of a false pass.

import type { PlanStore, PlanZone } from "../shared/plan_types.ts";
import { calleeIs, enclosingName, familyMatches, literalOf } from "./call_args.ts";
export { calleeIs, enclosingName, familyMatches, literalOf };

export type AccessOp = "write" | "read" | "watch";

export interface AccessSite {
  file: string;
  nodeId: string;
  line: number;
  /** the enclosing function (`onRequest`, `Writer.save`), or "module" */
  fn: string;
  /** the access function called, as written (`writeDoc`, `client.writeDoc`) */
  callee: string;
  op: AccessOp;
  /** the zone its literal arguments name, if any */
  zone?: string;
  /** the document family its literal arguments name, if any */
  family?: string;
  /** a literal argument names neither a zone nor a family, and some argument is computed */
  computed: boolean;
  literals: string[];
}

export const ACCESS_LIMITS = [
  "an access site is a call to a function the store's `access` names, read with its LITERAL arguments: a zone or family computed at run time is reported as computed (unverifiable), never matched by guess; a call through a function value passed around is not seen",
];


/** `orders/*`, `order-*`: a family pattern against a literal. */



function zoneNamed(zones: PlanZone[], lits: string[]): string | undefined {
  for (const z of zones) {
    const names = [z.id, ...(z.routedBy && !z.routedBy.startsWith("router:") ? [z.routedBy] : [])];
    if (lits.some((l) => names.includes(l))) return z.id;
  }
  return undefined;
}

/** Every call in the project to one of the store's access functions. */
export function storeAccessSites(store: PlanStore, files: Record<string, any>): AccessSite[] {
  const acc = store.access ?? {};
  const ops: AccessOp[] = ["write", "read", "watch"];
  if (!ops.some((o) => acc[o]?.length)) return [];
  const zones = store.zones ?? [];
  const families = zones.flatMap((z) => z.holds);
  const out: AccessSite[] = [];
  for (const [file, ir] of Object.entries(files)) {
    for (const n of (ir?.nodes ?? []) as any[]) {
      if (n.type !== "call") continue;
      const callee = String(n.callTarget ?? n.funcName ?? "");
      const op = ops.find((o) => acc[o]?.length && calleeIs(callee, acc[o]!));
      if (!op) continue;
      const args: string[] = Array.isArray(n.args) ? n.args.map(String) : [];
      const lits = args.map(literalOf).filter((x): x is string => x !== null);
      const zone = zoneNamed(zones, lits);
      const family = lits.find((l) => families.some((p) => familyMatches(p, l)));
      out.push({
        file, nodeId: n.id, line: Number(n.line) || 0, fn: enclosingName(n.id), callee, op,
        ...(zone ? { zone } : {}), ...(family ? { family } : {}),
        computed: !zone && args.length > lits.length, literals: lits,
      });
    }
  }
  return out;
}

/** The zone a site touches: named outright, or the one zone holding its family. */
export function siteZone(store: PlanStore, s: AccessSite): string | undefined {
  if (s.zone) return s.zone;
  if (!s.family) return undefined;
  const holders = (store.zones ?? []).filter((z) => z.holds.some((p) => familyMatches(p, s.family!)));
  return holders.length === 1 ? holders[0].id : undefined;
}
