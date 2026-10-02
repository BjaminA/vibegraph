// How a request moves, and how a verdict is reached.
export const REQUEST_STATES = [
  { from: "submitted", to: "under-review", roles: ["role:decider"] },
  { from: "under-review", to: "approved", roles: ["role:decider"], requires: ["inspection"] },
  { from: "under-review", to: "rejected", roles: ["role:decider"] },
];

export const VERDICT_TREE = {
  root: "has-inspection",
  nodes: [
    { id: "has-inspection", question: "Is there an inspection newer than 30 days?", reads: ["inspection"], evaluatedBy: "hasRecentInspection", yes: "readings-ok", no: "reject" },
    { id: "readings-ok", question: "Are the latest readings within limits?", reads: ["reading-*"], evaluatedBy: "readingsWithinLimits", yes: "approve", no: "reject" },
    { id: "approve", outcome: "approved" },
    { id: "reject", outcome: "rejected" },
  ],
};
