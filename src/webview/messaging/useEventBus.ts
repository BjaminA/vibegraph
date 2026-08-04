import { useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import { bridge, type AstNode, type SymbolEntry, type ProjectFileData, type PendingProposal, type SystemPlan, type Changeset, type PendingChangeset, type BuildPlan } from "../types";
import type { NodeFilters } from "../FiltersPanel";
import { buildLayout, astEdgesToFlow, applyFilters } from "../layout";

// Edit-state shape, exported for App.tsx to share the type.
export interface EditState {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
}

export interface EventBusActions {
  astNodesRef: React.MutableRefObject<AstNode[]>;
  symbolIndexRef: React.MutableRefObject<SymbolEntry[]>;
  projectDataRef: React.MutableRefObject<Record<string, ProjectFileData>>;

  setEditState: React.Dispatch<React.SetStateAction<EditState | null>>;
  setStubNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  // PLAN-v7 Stage 1 — clear the ghost overlay on reject.
  setPendingProposal: React.Dispatch<React.SetStateAction<PendingProposal | null>>;
  // PLAN-v7 Stage 3 — clear the pending architecture plan on reject.
  setPendingSystemPlan: React.Dispatch<React.SetStateAction<SystemPlan | null>>;
  // PLAN-v7 Stage 4 — clear the pending build increment on reject.
  setPendingChangeset: React.Dispatch<React.SetStateAction<PendingChangeset | null>>;
  // PLAN-v7 Stage 5 — clear the pending roadmap on reject.
  setPendingBuildPlan: React.Dispatch<React.SetStateAction<BuildPlan | null>>;
  setComposeError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveFilePath: React.Dispatch<React.SetStateAction<string | null>>;
  setZoomLevel: React.Dispatch<React.SetStateAction<"project" | "file">>;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  setHiddenNodeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface EventBusDeps {
  activeFilePath: string | null;
  hiddenNodeIds: Set<string>;
  nodeFilters: NodeFilters;
  // PLAN-v7 Stage 1 — the in-flight proposal, so accept can re-run the SAME op wet.
  pendingProposal: PendingProposal | null;
  // PLAN-v7 Stage 3 — the pending architecture plan, so accept can send the
  // full plan back for boundary re-validation + persistence.
  pendingSystemPlan: SystemPlan | null;
  // PLAN-v7 Stage 4 — the pending increment, so accept can send the full
  // changeset back for boundary re-validation + the wet build.
  pendingChangeset: PendingChangeset | null;
  // PLAN-v7 Stage 5 — the pending roadmap, so ratify can send it back.
  pendingBuildPlan: BuildPlan | null;
}

// Wires up the `vg-*` document-level custom event bus. Node components
// dispatch these via `document.dispatchEvent(new CustomEvent("vg-…", …))`
// — we don't change that contract. This hook just relocates the listener
// installation that used to live inline in App.tsx.
export function useEventBus(actions: EventBusActions, deps: EventBusDeps): void {
  const {
    astNodesRef, symbolIndexRef, projectDataRef,
    setEditState,
    setStubNodes, setPendingProposal, setPendingSystemPlan, setPendingChangeset, setPendingBuildPlan, setComposeError,
    setActiveFilePath, setZoomLevel, setNodes, setEdges, setHiddenNodeIds,
  } = actions;
  const { activeFilePath, hiddenNodeIds, nodeFilters, pendingProposal, pendingSystemPlan, pendingChangeset, pendingBuildPlan } = deps;

  useEffect(() => {
    const editHandler = (e: Event) => {
      const { nodeId } = (e as CustomEvent<{ nodeId: string }>).detail;
      const astNode = astNodesRef.current.find((n) => n.id === nodeId);
      if (!astNode) return;
      const label =
        (astNode as any).name ??
        (astNode as any).funcName ??
        (astNode as any).target ??
        astNode.type;
      setEditState({ nodeId, nodeType: astNode.type, nodeLabel: label });
    };

    // PLAN-v7 Stage 1 — the insert path is now propose-first. "Insert into
    // code" dry-runs the edit (compose-propose) and renders a ghost; the wet
    // compose-insert fires only when the human accepts the ghost.
    const stubInsertHandler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      bridge.postMessage({
        type: "compose-propose",
        payload: {
          mode: data.insertMode,
          anchorNodeId: data.anchorNodeId ?? null,
          filePath: data.filePath ?? activeFilePath ?? undefined,
          source: data.source,
        },
      });
    };

    // Accept the ghost → re-run the SAME op wet (the compose-insert path).
    // Byte-for-byte identical to the previewed ghost (G1 done-gate).
    const proposalAcceptHandler = () => {
      if (!pendingProposal) return;
      bridge.postMessage({
        type: "compose-insert",
        payload: {
          mode: pendingProposal.mode,
          anchorNodeId: pendingProposal.anchorNodeId,
          filePath: pendingProposal.filePath ?? activeFilePath ?? undefined,
          source: pendingProposal.source,
        },
      });
    };

    // Reject → drop the overlay. Nothing was ever written.
    const proposalRejectHandler = () => {
      setPendingProposal(null);
      setComposeError(null);
    };

    // PLAN-v7 Stage 3 — the system-plan gate. Propose sends an untrusted
    // plan for boundary validation (3a: the e2e/fixture dispatches this
    // event; 3b adds a drafted path). Accept sends the FULL pending plan
    // back — the server re-validates + persists ("same op twice"). Reject
    // drops the overlay; nothing was ever persisted.
    const systemProposeHandler = (e: Event) => {
      const { plan } = (e as CustomEvent<{ plan: SystemPlan }>).detail;
      bridge.postMessage({ type: "system-propose", payload: { plan } });
    };
    const systemPlanAcceptHandler = () => {
      if (!pendingSystemPlan) return;
      bridge.postMessage({ type: "system-plan-accept", payload: { plan: pendingSystemPlan } });
    };
    const systemPlanRejectHandler = () => {
      setPendingSystemPlan(null);
      setComposeError(null);
    };

    // PLAN-v7 Stage 4 — the changeset gate. Propose sends an untrusted
    // increment for the dry verification floor (4a: e2e/fixture-dispatched;
    // 4b adds the builder). Accept sends the FULL changeset back — the
    // server re-validates + builds wet ("same op twice"). Reject drops the
    // overlay; nothing was ever written.
    const changesetProposeHandler = (e: Event) => {
      const { changeset } = (e as CustomEvent<{ changeset: Changeset }>).detail;
      bridge.postMessage({ type: "changeset-propose", payload: { changeset } });
    };
    const changesetAcceptHandler = () => {
      if (!pendingChangeset || !pendingChangeset.floor.ok) return; // gate: floor must be green
      bridge.postMessage({ type: "changeset-accept", payload: { changeset: pendingChangeset.changeset } });
    };
    const changesetRejectHandler = () => {
      // PLAN-v7 Stage 5 — rejecting a RUN increment is a judgment: tell the
      // server so the item returns to pending and the run pauses.
      if (pendingChangeset?.runItemId) {
        bridge.postMessage({ type: "build-run-reject", payload: { itemId: pendingChangeset.runItemId } });
      }
      setPendingChangeset(null);
      setComposeError(null);
    };
    // PLAN-v7 6b — informed consent for an EFFECTFUL check: re-propose the
    // SAME changeset carrying the server-minted, scope-bound token. The
    // server re-validates the token against a FRESH scan before running
    // anything; the reply replaces this gate (check ran, marked consented).
    const changesetConsentHandler = (e: Event) => {
      // Sitting-2 — detail.trust routes the gate's trustToken instead of the
      // per-run consent token: session category-trust for unverifiable calls.
      const trust = !!(e as CustomEvent).detail?.trust;
      const check = pendingChangeset?.floor.check;
      const token = trust ? check?.trustToken : check?.consentToken;
      if (!pendingChangeset || !token) return;
      bridge.postMessage({
        type: "changeset-propose",
        payload: {
          changeset: pendingChangeset.changeset,
          ...(trust ? { trustUnverified: token } : { effectConsentToken: token }),
          ...(pendingChangeset.runItemId ? { runItemId: pendingChangeset.runItemId } : {}),
        },
      });
    };

    // PLAN-v7 Stage 5 — roadmap lifecycle + run controls (dispatched by the
    // RoadmapPanel; the server owns the artifact + the drive loop).
    const buildPlanProposeHandler = (e: Event) => {
      const { plan } = (e as CustomEvent<{ plan: BuildPlan }>).detail;
      bridge.postMessage({ type: "build-plan-propose", payload: { plan } });
    };
    const buildPlanAcceptHandler = () => {
      if (!pendingBuildPlan) return;
      bridge.postMessage({ type: "build-plan-accept", payload: { plan: pendingBuildPlan } });
    };
    const buildPlanRejectHandler = () => {
      setPendingBuildPlan(null);
      setComposeError(null);
    };

    // M-GF3.4 — apply a dialogue-proposed stage revision. A PENDING roadmap
    // lives client-side only → apply locally (the revision was already
    // dry-run-validated server-side against this very snapshot). A ratified
    // roadmap is the server's artifact → round-trip through
    // build-plan-item-modify (validated + persisted + rebroadcast).
    const stageRevisionApplyHandler = (e: Event) => {
      const { itemId, revised } = (e as CustomEvent<{
        itemId: string;
        revised: { capability: string; needs: string[] };
      }>).detail;
      if (pendingBuildPlan?.items.some((i) => i.id === itemId)) {
        setPendingBuildPlan({
          ...pendingBuildPlan,
          items: pendingBuildPlan.items.map((i) =>
            i.id === itemId ? { ...i, capability: revised.capability, needs: revised.needs } : i,
          ),
        });
      } else {
        bridge.postMessage({ type: "build-plan-item-modify", payload: { itemId, revision: revised } });
      }
    };

    const stubDiscardHandler = (e: Event) => {
      const { stubId } = (e as CustomEvent).detail;
      setStubNodes((prev) => prev.filter((n) => n.id !== stubId));
      setComposeError(null);
    };

    const zoomToFileHandler = (e: Event) => {
      const { filePath } = (e as CustomEvent).detail;
      const fd = projectDataRef.current[filePath];
      if (!fd) return;
      setActiveFilePath(filePath);
      setZoomLevel("file");
      astNodesRef.current = fd.nodes;
      symbolIndexRef.current = fd.symbolIndex ?? [];
      setNodes(buildLayout(
        applyFilters(fd.nodes, hiddenNodeIds, nodeFilters),
        (fd.edges ?? []).filter((e) => e.type === "reference"),
      ));
      setEdges(astEdgesToFlow(fd.edges ?? []));
    };

    const hideNodeHandler = (e: Event) => {
      const { nodeId } = (e as CustomEvent<{ nodeId: string }>).detail;
      setHiddenNodeIds((prev) => {
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });
    };

    // M8.3.3 — manual-seed pin from a function-def's NodeActionStrip.
    // We have nodeId in the event detail; activeFilePath tells us the
    // file. Server persists + re-discovers + re-extracts; the new seed
    // arrives in the next project-update payload.
    const addManualSeedHandler = (e: Event) => {
      const { nodeId } = (e as CustomEvent<{ nodeId: string }>).detail;
      if (!activeFilePath) return;
      bridge.postMessage({
        type: "add-manual-seed",
        payload: { filePath: activeFilePath, irNodeId: nodeId },
      });
    };

    document.addEventListener("vg-edit-node", editHandler);
    document.addEventListener("vg-stub-insert", stubInsertHandler);
    document.addEventListener("vg-stub-discard", stubDiscardHandler);
    document.addEventListener("vg-proposal-accept", proposalAcceptHandler);
    document.addEventListener("vg-proposal-reject", proposalRejectHandler);
    document.addEventListener("vg-system-propose", systemProposeHandler);
    document.addEventListener("vg-system-plan-accept", systemPlanAcceptHandler);
    document.addEventListener("vg-system-plan-reject", systemPlanRejectHandler);
    document.addEventListener("vg-changeset-propose", changesetProposeHandler);
    document.addEventListener("vg-changeset-accept", changesetAcceptHandler);
    document.addEventListener("vg-changeset-reject", changesetRejectHandler);
    document.addEventListener("vg-changeset-consent", changesetConsentHandler);
    document.addEventListener("vg-build-plan-propose", buildPlanProposeHandler);
    document.addEventListener("vg-build-plan-accept", buildPlanAcceptHandler);
    document.addEventListener("vg-build-plan-reject", buildPlanRejectHandler);
    document.addEventListener("vg-stage-revision-apply", stageRevisionApplyHandler);
    document.addEventListener("vg-zoom-to-file", zoomToFileHandler);
    document.addEventListener("vg-hide-node", hideNodeHandler);
    document.addEventListener("vg-add-manual-seed", addManualSeedHandler);
    return () => {
      document.removeEventListener("vg-edit-node", editHandler);
      document.removeEventListener("vg-stub-insert", stubInsertHandler);
      document.removeEventListener("vg-stub-discard", stubDiscardHandler);
      document.removeEventListener("vg-proposal-accept", proposalAcceptHandler);
      document.removeEventListener("vg-proposal-reject", proposalRejectHandler);
      document.removeEventListener("vg-system-propose", systemProposeHandler);
      document.removeEventListener("vg-system-plan-accept", systemPlanAcceptHandler);
      document.removeEventListener("vg-system-plan-reject", systemPlanRejectHandler);
      document.removeEventListener("vg-changeset-propose", changesetProposeHandler);
      document.removeEventListener("vg-changeset-accept", changesetAcceptHandler);
      document.removeEventListener("vg-changeset-reject", changesetRejectHandler);
      document.removeEventListener("vg-changeset-consent", changesetConsentHandler);
      document.removeEventListener("vg-build-plan-propose", buildPlanProposeHandler);
      document.removeEventListener("vg-build-plan-accept", buildPlanAcceptHandler);
      document.removeEventListener("vg-build-plan-reject", buildPlanRejectHandler);
      document.removeEventListener("vg-stage-revision-apply", stageRevisionApplyHandler);
      document.removeEventListener("vg-zoom-to-file", zoomToFileHandler);
      document.removeEventListener("vg-hide-node", hideNodeHandler);
      document.removeEventListener("vg-add-manual-seed", addManualSeedHandler);
    };
  }, [activeFilePath, hiddenNodeIds, nodeFilters, pendingProposal, pendingSystemPlan, pendingChangeset, pendingBuildPlan,
      astNodesRef, symbolIndexRef, projectDataRef,
      setEditState,
      setStubNodes, setPendingProposal, setPendingSystemPlan, setPendingChangeset, setPendingBuildPlan, setComposeError,
      setActiveFilePath, setZoomLevel, setNodes, setEdges, setHiddenNodeIds]);
}
