#!/usr/bin/env node
// A stand-in for the platform's read-only inventory command (a real one would
// list the store's partitions and access rules). It differs from the
// declaration on purpose: an undeclared zone, a missing grant, an extra grant.
const live = {
  version: "1",
  stores: [{ id: "docs" }],
  zones: [{ id: "requests", store: "docs" }, { id: "verdicts", store: "docs" }, { id: "evidence", store: "docs" }, { id: "scratch", store: "docs" }],
  grants: [
    { who: "role:intake", zone: "requests", access: "write" },
    { who: "svc-decider", zone: "requests", access: "read" },
    { who: "role:decider", zone: "verdicts", access: "write" },
    { who: "role:inspector", zone: "evidence", access: "write" },
    { who: "svc-decider", zone: "evidence", access: "read" },
    { who: "svc-intake", zone: "verdicts", access: "write" },
  ],
};
process.stdout.write(JSON.stringify(live) + "\n");
