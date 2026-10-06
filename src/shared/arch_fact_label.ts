// GROUP LABELS FROM FACTS (2026-10-06, direction review M12). A ratified
// group label is a sentence someone wrote once ("the admin host, 3 of 17
// identities, port 4000") and it went stale as the code moved. A group formed
// from facts carries `labelFrom: "facts"`, and its label is REBUILT from its
// members every time the map is derived: what every member shares — the
// identity the code runs it as, the port it listens on — and nothing a member
// does not use. Webview-safe.

import type { ArchNodeRecord } from "./protocol.ts";

/** The identity a box runs as, as the code shows it (arch_identity.ts), or null. */
export function identityOf(n: ArchNodeRecord): string | null {
  const id = n.identity?.[0];
  if (!id) return null;
  return id.kind === "created" ? "its own identity per run" : id.name;
}

/** The package root a cluster belongs to, from its id (`cluster:<family>:<root>[:<base>]`). */
export function rootOf(n: ArchNodeRecord): string {
  return n.id.split(":")[2] ?? ".";
}

const shared = <T,>(xs: Array<T | null | undefined>): T | null => (xs.length && xs.every((x) => x != null && x === xs[0]) ? (xs[0] as T) : null);

export function factLabel(members: ArchNodeRecord[]): string {
  if (!members.length) return "no members";
  const who = shared(members.map(identityOf));
  const port = shared(members.map((m) => m.runtime?.port ?? null));
  const root = shared(members.map(rootOf));
  const parts = [
    who ? `runs as ${who}` : root ? `package ${root === "." ? "(root)" : root}` : `${members.length} processes`,
    ...(port ? [`port ${port}`] : []),
  ];
  return parts.join(" · ").slice(0, 80);
}
