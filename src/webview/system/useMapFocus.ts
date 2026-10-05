// A chip's request to see a card on the map (2026-10-05, GUI brief M2): open
// the map, switch to the lens the card is drawn on (a `topo:` card lives on
// Resources), then select and centre the card once a layout holding it
// exists. A request carries a counter, so clicking the same chip twice asks
// twice. Returns the ref the canvas's onInit fills, for centring.

import { useEffect, useRef, useState } from "react";
import type { Node } from "@xyflow/react";
import type { ArchNodeRecord, ArchGroupRecord } from "../../shared/protocol";

type Selected = { node: ArchNodeRecord } | { group: ArchGroupRecord };
export interface FlowCentre { setCenter: (x: number, y: number, o?: { zoom?: number }) => void }

export function useMapFocus(opts: {
  request: { id: string; n: number } | null;
  nodes: Node[];
  toMap: () => void;
  toResources: () => void;
  select: (s: Selected) => void;
}) {
  const flowRef = useRef<FlowCentre | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const { request, nodes, toMap, toResources, select } = opts;
  useEffect(() => {
    if (!request) return;
    toMap();
    if (request.id.startsWith("topo:")) toResources();
    setPending(request.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);
  useEffect(() => {
    if (!pending) return;
    const n = nodes.find((x) => x.id === pending || x.id === `group:${pending}`);
    if (!n) return;
    const d = n.data as { node?: ArchNodeRecord; group?: ArchGroupRecord };
    if (d.node) select({ node: d.node });
    else if (d.group) select({ group: d.group });
    setPending(null);
    // Two frames: a lens switch remounts the canvas and its onInit sets the
    // first viewport; centring after it keeps the card in view.
    requestAnimationFrame(() => requestAnimationFrame(() => flowRef.current?.setCenter(n.position.x + 120, n.position.y + 40, { zoom: 1 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, nodes]);
  return flowRef;
}
