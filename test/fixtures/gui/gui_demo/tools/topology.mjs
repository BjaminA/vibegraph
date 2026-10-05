#!/usr/bin/env node
// The ledger's declared topology: two zones, two identities, who may write what.
const topology = {
  version: "1",
  stores: [{ id: "ledger", kind: "document store" }],
  zones: [
    { id: "status", store: "ledger", holds: ["status"] },
    { id: "approver", store: "ledger", holds: ["approver"] },
  ],
  principals: [
    { id: "order-service", kind: "service" },
    { id: "admin", kind: "role-holder" },
  ],
  grants: [
    { who: "order-service", zone: "status", access: "write" },
    { who: "order-service", zone: "approver", access: "read" },
    { who: "admin", zone: "approver", access: "write" },
  ],
};
process.stdout.write(JSON.stringify(topology));
