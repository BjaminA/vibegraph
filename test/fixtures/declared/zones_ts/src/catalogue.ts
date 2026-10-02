// Where each kind of record lives and who owns it. Zone names come from ZONE_OF;
// a bucket per zone is named by bucketFor.

export const RESOURCES = [
  { key: "/orders/{id}", owners: ["sales"], readers: ["finance", "support"] },
  { key: "/ledger/{id}", owners: ["owner-of-entry"], readers: ["finance"] },
  { key: "/audit/{id}", owners: ["any-service"], readers: ["auditor"] },
];

export const ZONE_OF: Record<string, string> = {
  "/orders/{id}": "orders",
  "/ledger/{id}": "ledger",
  "/audit/{id}": "audit",
};

const BILLING = "billing-svc";

/** Who may write each zone: the catalogue, then the decisions made here. */
export function writersByZone(tenants: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (z: string, w: string[]) => { out[z] = [...new Set([...(out[z] ?? []), ...w])]; };
  for (const r of RESOURCES) add(ZONE_OF[r.key], r.owners);
  // only billing writes the ledger
  out.ledger = [BILLING];
  add("audit", [BILLING]);
  for (const t of tenants) out[`tenant_${t}`] = [t];
  return out;
}

/** The bucket a zone lives in. */
export const bucketFor = (prefix: string, zone: string) => `${prefix}-${zone.replace(/_/g, "-").toLowerCase()}`;

export const ledgerKey = (id: string) => `/ledger/${id}`;
