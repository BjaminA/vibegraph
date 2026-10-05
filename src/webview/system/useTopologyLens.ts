// The declared topology on the map (2026-10-02; moved out of SystemView
// 2026-10-05): which topology lens is showing, its model, the model with a
// selected card's folded reads drawn (the cards stay where the unfocused
// model placed them — buildArchLayout's placeEdges), and the trace selection.

import { useMemo, useState } from "react";
import { useTopologyState } from "../useTopologyState";
import { decisionsModel, resourcesModel } from "./arch_topology";

interface ThreadLike { entryPointId: string | null; nodes: any[] }

export function useTopologyLens(opts: { lens: string; onMap: boolean; threads: ThreadLike[]; selectedNodeId: string | null }) {
  const { lens, onMap, threads, selectedNodeId } = opts;
  const topo = useTopologyState();
  const hasTopology = !!topo.model && topo.model.status.length > 0;
  const topoLens = (lens === "resources" || lens === "decisions") && hasTopology ? lens : null;
  const [traceName, setTraceName] = useState("");
  const [traceIndex, setTraceIndex] = useState(0);
  const topoMapModel = useMemo(() => {
    if (!onMap || !topoLens || !topo.model) return null;
    return topoLens === "resources" ? resourcesModel(topo.model, threads, topo.live?.drift) : decisionsModel(topo.model, threads);
  }, [onMap, topoLens, topo, threads]);
  const topoFocus = topoLens === "resources" ? selectedNodeId : null;
  const topoDrawn = useMemo(() => (topoMapModel && topoFocus && topo.model
    ? resourcesModel(topo.model, threads, topo.live?.drift, { focus: topoFocus })
    : topoMapModel), [topoMapModel, topoFocus, topo, threads]);
  return { topo, hasTopology, topoMapModel, topoDrawn, traceName, setTraceName, traceIndex, setTraceIndex };
}
