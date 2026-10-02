// Every document goes to the zone its family lives in, decided at run time.
import { ZONES } from "../catalogue/zones.mjs";

/** The zone a document family belongs to. */
export function zoneFor(family: string): string {
  const z = ZONES.find((x) => x.holds.some((h) => h === family || (h.endsWith("*") && family.startsWith(h.slice(0, -1)))));
  if (!z) throw new Error(`no zone holds ${family}`);
  return z.id;
}
