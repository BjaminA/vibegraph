// Which of a container's members it is drawn around (2026-10-05).
//
// A card several calls reach is ONE card, drawn at the first call the
// layout's walk reached (ThreadLayout.placedBy). A container (an `if` arm, a
// `try`) lists every call written inside it, so a shared card — an external
// like `setTimeout`, a helper called from three `if` blocks — is a member of
// several containers at once. Boxing every member stretched a container from
// its own call site to wherever the shared card was drawn, over every card
// between (a 276-card thread had 99 cards straddling a box edge and sibling
// boxes overlapping by millions of px²). A container now wraps the members
// placed by a call WRITTEN INSIDE IT: the placing call's structural id
// (edge `irSource`, e.g. `module/main.fn/if@3/check.call`) starts with the
// container's own (`module/main.fn/if@3`), in the same file. A member drawn
// at another call keeps its edge; only the box stops claiming to hold it.

import type { Placement } from "./useThreadLayout";

interface NodeLike { id: string; kind: string; file: string | null; irNodeId: string | null }

/** `containsChildren` — when given, a container NONE of whose members is
 *  drawn at its own site keeps all of them (the box it always had): a loop
 *  whose only call is drawn under an earlier loop is still a loop, and
 *  dropping it would lose that it repeats. */
export function homeMembers(
  nodes: readonly NodeLike[],
  placedBy: Map<string, Placement> | undefined,
  containsChildren?: Map<string, string[]>,
): HomeTest {
  if (!placedBy) return Object.assign(() => true, { fallback: () => false });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placedHere = (c: string, m: string): boolean => {
    const at = placedBy.get(m);
    const box = byId.get(c);
    // The seed, an orphan, or a container with no structural id: no claim to test.
    if (!at || !box?.irNodeId) return true;
    if (!at.src) return false;
    return byId.get(at.from)?.file === box.file && at.src.startsWith(`${box.irNodeId}/`);
  };
  const leaves = (c: string, seen = new Set<string>()): string[] => {
    if (seen.has(c)) return [];
    seen.add(c);
    return (containsChildren?.get(c) ?? []).flatMap((k) => (byId.get(k)?.kind === "container" ? leaves(k, seen) : [k]));
  };
  const noneHere = new Map<string, boolean>();
  const fallback = (c: string): boolean => {
    if (!containsChildren) return false;
    if (!noneHere.has(c)) noneHere.set(c, !leaves(c).some((l) => placedHere(c, l)));
    return noneHere.get(c)!;
  };
  const home = (c: string, m: string) => placedHere(c, m) || fallback(c);
  return Object.assign(home, { fallback });
}

/** Is this member boxed by this container? `fallback(c)` — true when the box
 *  falls back to members drawn elsewhere: the caller draws it only if it then
 *  covers no card that is not its member. */
export type HomeTest = ((containerId: string, member: string) => boolean) & { fallback: (containerId: string) => boolean };
