// NAVIGATION hops (2026-09-29): a page naming the page the user goes to
// next. Split out of crossings.ts, whose index builder calls it; the same
// literal-join shape as the HTTP / command / tool kinds there.

import type { CrossingRecord, CrossingTargetRecord } from "../shared/protocol.ts";
import { nodeCallee } from "../../scripts/frontends/script_refs.mjs";
import { isParamSegment, pathMatchesRoute, urlPath, type CrossingEnvelopeLike, type RouteEntryLike } from "./crossings.ts";

type Crossing = CrossingRecord;
type CrossingTarget = CrossingTargetRecord;

// ── 2026-09-29 — NAVIGATION: a page naming the page the user goes to next ──
//
// `<Link href="/orders">`, `router.push("/orders")`, `redirect("/login")` are
// the same literal join over a URL path, with a page (a Next App Router
// `page.tsx`, discovered as a route with `next: "page"`) as the callee. They
// are NOT execution: the user moves on, nothing is called. So they are kept
// in their own list, apart from `all`/`byThread` — the contract's "reaches",
// the architecture's process edges and the rank facts read those, and a link
// is none of them. A computed target (`router.push(url)`) has no literal and
// is not a hop; an absolute URL leaves the app and is not one either.

const NAV_TAG = /(^|\.)(Link|NavLink)$/;
const NAV_CALL = /(^|\.)router\.(push|replace|prefetch)$|^(redirect|permanentRedirect|navigate)$/;

/** The static app path a navigation literal names, or null. */
export function navPath(raw: string): string | null {
  let v = raw.trim();
  if (v.startsWith("{") && v.endsWith("}")) v = v.slice(1, -1).trim();
  if (!/^["'`]/.test(v)) return null; // a variable, an object, a call: computed
  const s = v.slice(1, -1);
  if (!s.startsWith("/") || s.startsWith("//")) return null; // absolute, protocol-relative, #hash, ?query
  return urlPath(v);
}

/** The literal a navigation node names: `href=`/`to=` on a Link tag, the
 *  first argument of a router call. */
function navLiteral(n: any): { path: string; callee: string } | null {
  const callee = nodeCallee(n);
  const args: string[] = Array.isArray(n.args) ? n.args.filter((a: unknown): a is string => typeof a === "string") : [];
  if (n.jsx && NAV_TAG.test(callee)) {
    for (const a of args) {
      const m = /^(href|to)\s*=\s*([\s\S]*)$/.exec(a);
      if (!m) continue;
      const p = navPath(m[2]);
      if (p) return { path: p, callee: `<${callee}>` };
    }
    return null;
  }
  if (!n.jsx && NAV_CALL.test(callee) && args[0]) {
    const p = navPath(args[0]);
    return p ? { path: p, callee } : null;
  }
  return null;
}

/** The App Router's own order: a static segment outranks a dynamic one, so
 *  `/orders/new` is `orders/new/page.tsx`, not `orders/[id]`; and an
 *  interpolated caller segment (`/orders/${id}`) is a VALUE, served by the
 *  dynamic segment rather than by one static name it might happen to equal.
 *  Only the best-scoring pages stay; a tie stays ambiguous. */
function mostSpecific(path: string, pages: RouteEntryLike[]): RouteEntryLike[] {
  if (pages.length < 2) return pages;
  const a = path.split("/").filter(Boolean);
  const score = (p: RouteEntryLike) => {
    const b = String(p.metadata!.route).split("/").filter(Boolean);
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const ap = isParamSegment(a[i]), bp = isParamSegment(b[i] ?? "");
      if (!ap && !bp && a[i] === b[i]) s += 2;
      else if (ap && bp) s += 1;
    }
    return s;
  };
  const best = Math.max(...pages.map(score));
  return pages.filter((p) => score(p) === best);
}

export function navigationCrossings(
  env: CrossingEnvelopeLike, ep: string, reached: string[], reachedNodeIds: Set<string>, pages: RouteEntryLike[],
): Crossing[] {
  const out: Crossing[] = [];
  for (const file of reached) {
    for (const n of env.files[file]?.nodes ?? []) {
      if (!n || typeof n.id !== "string" || (reachedNodeIds.size && !reachedNodeIds.has(n.id))) continue;
      const nav = navLiteral(n);
      if (!nav) continue;
      const raw = pages.filter((p) => pathMatchesRoute(nav.path, p.metadata!.route as string));
      const matches = mostSpecific(nav.path, raw);
      if (matches.some((p) => p.id === ep)) continue; // a page linking to itself
      const targets: CrossingTarget[] = matches.map((p) => ({
        entryPointId: p.id, route: p.metadata!.route as string, method: "GET", ...(p.framework ? { framework: p.framework } : {}),
      }));
      const confidence: Crossing["confidence"] = targets.length === 0 ? "unmatched" : targets.length > 1 ? "ambiguous" : "path";
      const notes: string[] = [];
      if (!targets.length) notes.push("no page in this project serves that path (a route handler, an API path, a page outside the parsed tree, or a typo)");
      if (targets.length > 1) notes.push(`${targets.length} pages serve that path shape and nothing here separates them`);
      if (raw.length > matches.length) notes.push(`${raw.filter((p) => !matches.includes(p)).map((p) => p.metadata!.route).join(", ")} also fit${raw.length - matches.length === 1 ? "s" : ""} the shape; a static segment outranks a dynamic one (the router's own order)`);
      notes.push("a navigation is the user's next page, not a call: it is kept apart from the thread's hops");
      out.push({ kind: "navigation", entryPointId: ep, file, nodeId: n.id, callee: nav.callee, path: nav.path, method: null, targets, confidence, note: notes.join("; ") });
    }
  }
  return out;
}
