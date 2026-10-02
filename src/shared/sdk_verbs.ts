// What a call to a platform SDK DOES, from the verb in its method name
// (2026-10-02, module 3). `SaveAccess`, `put_object`, `WatchDocumentPath`,
// `createAcls`, `subscribe`: on a data platform the method name carries the
// effect. One taxonomy for every tool family, with the noun that turns a write
// into a GRANT, and payload keys that do the same when the name does not.
// Webview-safe.

import type { SdkEffect } from "./data_arch_types.ts";

/** The first word of a method name → what it does. */
export const VERB_EFFECTS: Record<string, SdkEffect> = {
  get: "read", read: "read", list: "read", find: "read", query: "read", fetch: "read", can: "read",
  has: "read", describe: "read", head: "read", scan: "read", search: "read", count: "read",
  exists: "read", check: "read", lookup: "read", download: "read", load: "read", select: "read", batchget: "read",
  save: "write", set: "write", write: "write", put: "write", update: "write", insert: "write",
  upsert: "write", send: "write", publish: "write", append: "write", push: "write", upload: "write",
  post: "write", patch: "write", produce: "write", emit: "write", store: "write", copy: "write",
  register: "write", commit: "write", replace: "write", add: "write", batchwrite: "write", enqueue: "write",
  create: "admin", delete: "admin", remove: "admin", drop: "admin", destroy: "admin", alter: "admin",
  ensure: "admin", provision: "admin", purge: "admin", truncate: "admin", deregister: "admin",
  watch: "watch", subscribe: "watch", listen: "watch", consume: "watch", poll: "watch", observe: "watch",
  tail: "watch", on: "watch", receive: "watch",
  grant: "grant", revoke: "grant", allow: "grant", deny: "grant", authorize: "grant",
};

/** A write or admin call on one of these nouns changes who may do what. */
export const GRANT_NOUN = /(access|acls?|policy|policies|permissions?|iam|grants?|share|bindings?)$/i;

/** Payload keys that make a call a grant whatever its name. */
const WHO_KEYS = /^(principal|identity|identity_did|identityDid|grantee|member|members|user|subject|account)$/i;
const WHAT_KEYS = /^(access|permission|permissions|operation|role|action|actions|permissionType)$/i;

/** `SaveAccess` → ["save", "access"]; `put_object` → ["put", "object"]. */
export function verbWords(method: string): string[] {
  return method.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[\s_]+/).filter(Boolean).map((w) => w.toLowerCase());
}

export function effectOf(method: string, keys: string[] = []): SdkEffect {
  const words = verbWords(method);
  const verb = VERB_EFFECTS[words[0] ?? ""] ?? VERB_EFFECTS[(words[0] ?? "") + (words[1] ?? "")] ?? "call";
  const flat = keys.map((k) => k.split(".").pop() ?? k);
  const grantKeys = flat.some((k) => WHO_KEYS.test(k)) && flat.some((k) => WHAT_KEYS.test(k));
  if ((verb === "write" || verb === "admin") && (GRANT_NOUN.test(words.slice(1).join("")) || grantKeys)) return "grant";
  return verb;
}
