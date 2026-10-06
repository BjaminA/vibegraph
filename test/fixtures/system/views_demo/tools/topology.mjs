#!/usr/bin/env node
// The order ledger's declared topology: its zones, who may write each, the
// order's phases and the release tree.
const roles = ["clerk", "auditor", "partner"];
const topology = {
  version: "1",
  stores: [{ id: "ledger", kind: "document store", label: "order ledger documents" }],
  zones: [
    { id: "status", store: "ledger", holds: ["status"] },
    { id: "approver", store: "ledger", holds: ["approver"] },
    { id: "records_intake", store: "ledger", holds: ["records_intake"] },
    { id: "records_review", store: "ledger", holds: ["records_review"] },
    ...roles.map((r) => ({ id: `request_${r}`, store: "ledger", holds: [`request_${r}`] })),
  ],
  principals: [
    { id: "decider", kind: "service" },
    { id: "admin", kind: "role-holder" },
    { id: "gateway", kind: "service" },
    ...roles.filter((r) => r !== "partner").map((r) => ({ id: r, kind: "role-holder" })),
  ],
  grants: [
    { who: "decider", zone: "status", access: "write" },
    { who: "admin", zone: "approver", access: "write" },
    { who: "clerk", zone: "records_intake", access: "write" },
    { who: "auditor", zone: "records_review", access: "write" },
    { who: "clerk", zone: "request_clerk", access: "write" },
    { who: "auditor", zone: "request_auditor", access: "write" },
    { who: "gateway", zone: "request_partner", access: "write" },
    { who: "decider", zone: "approver", access: "read" },
    { who: "gateway", zone: "status", access: "read" },
  ],
  stateMachines: [{
    id: "order-phase", family: "status", states: ["filed", "held", "released"], evaluatedBy: "applyTransition",
    transitions: [{ from: "filed", to: "held", roles: ["decider"] }, { from: "filed", to: "released", roles: ["decider"] }, { from: "held", to: "released", roles: ["decider"] }],
  }],
  decisionTrees: [{
    id: "release", root: "Q1",
    nodes: [
      { id: "Q1", question: "Is an approver appointed?", reads: ["approver"], evaluatedBy: "checkApprover", yes: "Q2", no: "HOLD" },
      { id: "Q2", question: "Is the request filed?", reads: ["request_clerk"], evaluatedBy: "applyTransition", yes: "RELEASE", no: "HOLD" },
      { id: "RELEASE", outcome: "release" },
      { id: "HOLD", outcome: "hold" },
    ],
  }],
};
process.stdout.write(JSON.stringify(topology));
