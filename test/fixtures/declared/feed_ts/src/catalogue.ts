// Where each kind of document lives. An inbox per role and user: which inboxes
// exist is only known at run time (the registry lists them), their shape is not.

export const RESOURCES = [
  { key: "inbox_{Role}__{User}", owners: ["owner-of-inbox", "decider"], readers: ["decider"] },
  { key: "status", owners: ["decider"], readers: ["clerk"] },
];

export const ZONE_OF: Record<string, string> = {
  "inbox_{Role}__{User}": "inbox",
  "status": "status",
};
