#!/usr/bin/env node
// A warehouse's declared topology at the scale where drawing every grant stops
// being readable: 50 zones (one per aisle and record kind), 24 roles, every
// role may READ every zone, and one or two roles WRITE each. 1,200 read grants
// that all say the same thing, 75 write grants that each say something.
const kinds = ["stock", "picks", "counts", "returns", "audits"];
const aisles = Array.from({ length: 10 }, (_, i) => `a${String(i + 1).padStart(2, "0")}`);
const roles = [
  ...aisles.map((a) => `picker-${a}`),
  ...aisles.map((a) => `counter-${a}`),
  "returns-desk", "auditor", "supervisor", "inventory-service",
];
const zones = aisles.flatMap((a) => kinds.map((k) => `${k}_${a}`));
const writersOf = (z) => {
  const [k, a] = z.split("_");
  if (k === "stock") return ["inventory-service"];
  if (k === "picks") return [`picker-${a}`, "supervisor"];
  if (k === "counts") return [`counter-${a}`];
  if (k === "returns") return ["returns-desk"];
  return ["auditor"];
};
const topology = {
  version: "1",
  stores: [{ id: "warehouse", kind: "document store" }],
  zones: zones.map((z) => ({ id: z, store: "warehouse", holds: [z.split("_")[0]] })),
  principals: roles.map((r) => ({ id: r, kind: r.endsWith("-service") ? "service" : "role-holder", roles: [r] })),
  grants: [
    ...zones.flatMap((z) => writersOf(z).map((r) => ({ who: `role:${r}`, zone: z, access: "write" }))),
    ...zones.flatMap((z) => roles.map((r) => ({ who: `role:${r}`, zone: z, access: "read" }))),
  ],
};
process.stdout.write(JSON.stringify(topology));
