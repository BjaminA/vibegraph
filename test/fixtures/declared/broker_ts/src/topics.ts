// The topic catalogue: every topic family, who produces it and who consumes it.
// Topic names are computed per environment and tenant, so no literal names one.

export const TOPICS = [
  { topic: "{env}.invoices.{tenantId}", producers: ["billing"], consumers: ["ledger", "mailer"], schema: "invoice" },
  { topic: "{env}.payments.{tenantId}", producers: ["ledger"], consumers: ["billing"], schema: "payment" },
  { topic: "{env}.audit", producers: ["billing", "ledger"], consumers: ["auditor"], schema: "audit" },
] as const;

export const FLAGS = {
  newPricing: { enabled: true, owner: "billing" },
  dunning: { enabled: false, owner: "ledger" },
};

/** The topic one tenant's events of one family go to. */
export const topicFor = (env: string, family: string, tenantId: string) => `${env}.${family}.${tenantId}`;

/** The environment-wide audit topic. */
export function auditTopic(env: string): string {
  return `${env}.audit`;
}

/** A name nothing can reduce: it is chosen at run time from a hash. */
export function shardTopic(env: string, key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return [env, "shard", String(Math.abs(h) % 8)].join(".");
}

/** A consumer group per team: the team is lower-cased on the way in. */
export const groupFor = (team: string) => `grp-${team.toLowerCase()}`;
