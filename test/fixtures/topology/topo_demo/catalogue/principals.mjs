// Who the platform knows, and what each may touch.
export const PRINCIPALS = [
  { id: "svc-intake", kind: "service", roles: ["intake"] },
  { id: "svc-decider", kind: "service", roles: ["decider"] },
  { id: "inspector", kind: "human", roles: ["inspector"] },
];

export const GRANTS = [
  { who: "role:intake", zone: "requests", access: "write" },
  { who: "svc-decider", zone: "requests", access: "read" },
  { who: "role:decider", zone: "verdicts", access: "write" },
  { who: "svc-intake", zone: "verdicts", access: "read" },
  { who: "role:inspector", zone: "evidence", access: "write" },
  { who: "svc-decider", zone: "evidence", access: "read" },
];
