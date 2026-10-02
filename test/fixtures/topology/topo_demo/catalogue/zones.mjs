// The partitions of the shared store. Access is enforced per zone.
export const STORE = { id: "docs", kind: "sync-db" };

export const ZONES = [
  { id: "requests", holds: ["request"] },
  { id: "verdicts", holds: ["verdict"] },
  { id: "evidence", holds: ["inspection", "reading-*"] },
];
