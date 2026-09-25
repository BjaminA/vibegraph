// M-ARCH.5 (PLAN-M-ARCH.md) — the ArchModel flattened into Archify's own
// architecture schema (tt-a1i/archify, schema_version 1), so their CLI can
// validate and render the same picture: "incorporate" in the literal sense,
// without vendoring their renderer.
//
// Archify's schema is an EXPORT TARGET, never our model, and the flattening
// loses things — which the file itself says, in a card:
//   - `components.type` has seven values; our categories have thirteen and
//     our roles more (platform → cloud, scripts → backend, unknown → external);
//   - there is no provenance field, so only DERIVED nodes and edges and
//     STATED groups are exported — a PROPOSED group has no honest place in a
//     schema that cannot say "proposed", and is counted instead;
//   - `boundaries.kind` is region | security-group, so host / region / zone /
//     process → region and trust / network / subnet / account → security-group;
//   - ids must match ^[a-zA-Z][a-zA-Z0-9_-]*$, so ours are slugged, and the
//     slug → id table rides in a card.
// Positions are OUR deterministic layout, handed over as grid rows and
// columns — nobody picks them, theirs included.
//
// Pure: model in, JSON out. Byte-stable for one model.

import type { ArchModelRecord } from "../shared/protocol.ts";
import type { ArchCategory } from "../shared/arch_protocol.ts";
import { buildArchLayout, edgeLabel } from "../webview/system/archLayout.ts";
import { routeEdges } from "../webview/system/arch_route.ts";

type ArchifyType = "frontend" | "backend" | "database" | "cloud" | "security" | "messagebus" | "external";

const TYPE_OF: Record<ArchCategory, ArchifyType> = {
  frontend: "frontend",
  backend: "backend", agent: "backend", scripts: "backend", pipeline: "backend",
  database: "database", cache: "database", storage: "database",
  queue: "messagebus",
  platform: "cloud", cloud: "cloud", model: "cloud",
  external: "external", unknown: "external",
};

const BOUNDARY_KIND: Record<string, "region" | "security-group"> = {
  host: "region", region: "region", zone: "region", process: "region",
  trust: "security-group", network: "security-group", subnet: "security-group", account: "security-group",
};

function slugger(): (id: string) => string {
  const used = new Map<string, string>();
  const taken = new Set<string>();
  return (id: string) => {
    const hit = used.get(id);
    if (hit) return hit;
    let base = id.replace(/^cluster:/, "c-").replace(/^tool:/, "t-").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/-$/, "");
    if (!/^[a-zA-Z]/.test(base)) base = `n-${base}`;
    let s = base || "n";
    for (let i = 2; taken.has(s); i++) s = `${base}-${i}`;
    taken.add(s);
    used.set(id, s);
    return s;
  };
}

/** Archify's renderer measures text at ~6.5px per character at the label
 *  size and ~6px at its legible minimum for a sublabel, and rejects a box
 *  that cannot hold either. Boxes are sized from the text, the grid from
 *  the widest box. */
const LABEL_PX = 7.2;
const SUB_PX = 6.3;
const BOX_PAD = 24;
const BOX_H = 64;
/** Archify's grid (renderers/architecture/grid.mjs): origin, and the gaps we set. */
const ORIGIN: [number, number] = [40, 80];
const GAP_X = 240;
const GAP_Y = 88;

/** Archify's label chip: 8px text at ~4.8px a unit plus 10, 14px tall; its
 *  text baseline sits 3px below the chip's centre. */
const archifyLabel = (text: string) => ({ w: Math.ceil(text.length * 4.8 + 10), h: 14 });

/** A shorter sublabel than the map's: Archify draws one line, and the long
 *  role description lives in the id card and the map, not here. */
function shortSublabel(n: ArchModelRecord["nodes"][number]): string {
  if (n.kind === "tool") return [n.role ?? "tool", n.version ? `v${n.version}` : ""].filter(Boolean).join(" · ");
  const eps = n.entryPoints?.length ?? 0;
  return `${eps} entry point${eps === 1 ? "" : "s"} · ${n.files ?? 0} files`;
}

export interface ArchifyOptions {
  title: string;
  commit?: string | null;
  tool?: string;
  /** Archify verifies every cited source against a PINNED commit in a real
   *  checkout whose origin matches `url`, so sources are cited only when the
   *  caller knows all three: the origin URL, the full 40-hex commit, and the
   *  analysed root's path inside the checkout (`prefix`, "" at the top). */
  repository?: { url: string; revision: string; prefix: string; web: boolean } | null;
}

export function toArchify(model: ArchModelRecord, opts: ArchifyOptions): Record<string, unknown> {
  const slug = slugger();
  // Archify gets every tool (its schema has no collapsed box), in our column order.
  const layout = buildArchLayout(model, "overview", { collapseTools: false });
  const xs = [...new Set(layout.nodes.filter((n) => n.type === "archNode").map((n) => n.position.x))].sort((a, b) => a - b);
  const colOf = new Map<string, number>();
  const rowOf = new Map<string, number>();
  for (const x of xs) {
    const inCol = layout.nodes.filter((n) => n.type === "archNode" && n.position.x === x).sort((a, b) => a.position.y - b.position.y);
    inCol.forEach((n, i) => { colOf.set(n.id, xs.indexOf(x)); rowOf.set(n.id, i); });
  }

  const nodes = [...model.nodes].sort((a, b) => (colOf.get(a.id) ?? 0) - (colOf.get(b.id) ?? 0) || (rowOf.get(a.id) ?? 0) - (rowOf.get(b.id) ?? 0) || a.id.localeCompare(b.id));
  const components = nodes.map((n) => {
    const repo = opts.repository;
    const sources = !repo ? [] : [...new Set(n.refs.filter((r) => r.file).map((r) => r.file))].slice(0, 3)
      .map((f) => ({ path: `${repo.prefix ? `${repo.prefix}/` : ""}${f}` }));
    const sublabel = shortSublabel(n);
    const w = Math.ceil(Math.max(n.label.length * LABEL_PX, sublabel.length * SUB_PX) + BOX_PAD);
    return {
      id: slug(n.id),
      type: TYPE_OF[n.category] ?? "external",
      label: n.label,
      sublabel,
      tag: n.kind === "tool" ? (n.origin ?? "tool") : n.kind === "hub" ? "dispatcher" : (n.frameworks?.join(", ") || n.family || "cluster"),
      ...(sources.length ? { sources } : {}),
      row: rowOf.get(n.id) ?? 0,
      col: colOf.get(n.id) ?? 0,
      size: [Math.max(140, w), BOX_H] as [number, number],
    };
  });
  const cellW = Math.max(140, ...components.map((c) => c.size[0]));
  const known = new Set(model.nodes.map((n) => n.id));
  const stated = model.groups.filter((g) => g.source === "stated");
  const boundaries = stated
    .map((g) => ({
      kind: BOUNDARY_KIND[g.kind] ?? "region",
      label: `${g.label} (${g.kind})`,
      wraps: g.wraps.filter((w) => known.has(w)).map(slug),
    }))
    .filter((b) => b.wraps.length > 0);
  // Routes through the empty lanes (arch_route.ts, the map's own router), on
  // Archify's grid geometry. Ports are NOT spread: with explicit points,
  // Archify anchors each end at the side's midpoint. Labels are placed where
  // no card and no other label is, with Archify's label metrics.
  const stepX = cellW + GAP_X, stepY = BOX_H + GAP_Y;
  const boxes = components.map((c, i) => ({ id: nodes[i].id, col: c.col, x: ORIGIN[0] + c.col * stepX, y: ORIGIN[1] + c.row * stepY, w: c.size[0], h: BOX_H }));
  const drawnEdges = [...model.edges].sort((a, b) => a.id.localeCompare(b.id)).filter((e) => boxes.some((b) => b.id === e.from) && boxes.some((b) => b.id === e.to));
  const routes = routeEdges(boxes, drawnEdges.map((e) => ({ id: e.id, from: e.from, to: e.to, labelW: archifyLabel(edgeLabel(e)).w, labelH: 14 })), {
    spreadPorts: false, portBand: () => ({ top: 0, bottom: BOX_H }), gapAfterLast: GAP_X / 2,
  });
  const connections = drawnEdges.map((e) => {
    const weak = e.confidence === "ambiguous" || e.protocolPresence || e.protocol === "unknown";
    const r = routes.get(e.id)!;
    const pts = r.points;
    const a = boxes.find((b) => b.id === e.from)!, b = boxes.find((x) => x.id === e.to)!;
    const side = (p: [number, number], box: typeof a) => (Math.abs(p[0] - box.x) < 0.5 ? "left" : "right") as "left" | "right";
    return {
      from: slug(e.from),
      to: slug(e.to),
      label: edgeLabel(e),
      variant: weak ? "dashed" : e.kind === "uses" ? "default" : "emphasis",
      fromSide: side(pts[0], a),
      toSide: side(pts[pts.length - 1], b),
      via: pts.slice(1, -1),
      ...(r.label ? { labelAt: [r.label.cx, r.label.cy + 3] as [number, number] } : {}),
    };
  });

  const clusters = nodes.filter((n) => n.kind === "cluster" || n.kind === "hub").map((n) => slug(n.id));
  const tools = nodes.filter((n) => n.kind === "tool").map((n) => slug(n.id));
  const views = [
    ...(clusters.length ? [{ id: "clusters", label: "The project's processes", focus: clusters, note: "entry points clustered by framework under a package manifest" }] : []),
    ...(tools.length ? [{ id: "tools", label: "What it talks to", focus: tools, note: "boundary tools the threads were seen calling" }] : []),
  ];
  const proposed = model.groups.filter((g) => g.source === "proposed").length;
  const u = model.unplaced;
  const provenance = [
    `Derived by ${opts.tool ?? "VibeGraph"} from the code's IR${opts.commit ? ` at ${opts.commit}` : ""}: every component, connection and protocol label is read from a fact, not written by a model.`,
    "Flattened into Archify's schema, which has no provenance field: types are coarser than our categories (platform → cloud, scripts → backend, unknown → external).",
    opts.repository ? `Sources are pinned to ${opts.repository.revision}.` : "No sources are cited: Archify verifies a source against a pinned commit in a checkout with an origin remote, and none was given.",
    `Boundaries are the STATED groups only${proposed ? `; ${proposed} proposed group(s) awaiting ratification are not exported` : ""}.`,
    `Not drawn: ${u.tests} tests, ${u.unmatchedHops} unmatched hops, ${u.unattributedBoundaries} unattributed call sites${u.toolsPresentNotCalled.length ? `, ${u.toolsPresentNotCalled.length} tools present but never called` : ""}.`,
  ];
  const ids = nodes.map((n) => `${slug(n.id)} = ${n.id}`);
  return {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title: opts.title,
      subtitle: "derived from the code by VibeGraph",
      ...(opts.repository ? { repository: { url: opts.repository.url, revision: opts.repository.revision, link_mode: opts.repository.web ? "web" : "local-only" } } : {}),
      ...(views.length ? { views } : {}),
      legend: { mode: "auto" },
    },
    // Wide gaps: every edge carries a protocol label, and Archify rejects a
    // label that overlaps a box.
    layout: { mode: "grid", origin: ORIGIN, cols: Math.max(1, ...components.map((c) => c.col + 1)), cellW, cellH: BOX_H, gapX: GAP_X, gapY: GAP_Y },
    components,
    ...(boundaries.length ? { boundaries } : {}),
    ...(connections.length ? { connections } : {}),
    cards: [
      { dot: "slate", title: "Provenance", items: provenance },
      { dot: "cyan", title: "VibeGraph ids", items: ids },
    ],
  };
}
