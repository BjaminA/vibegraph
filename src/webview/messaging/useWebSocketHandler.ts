import { useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import {
  bridge,
  type AstNode, type AstPayload, type SymbolEntry,
  type ProjectFileData, type EntryPoint, type ProjectThread,
  type SystemTier, type SystemPlan, type PendingProposal, type PendingChangeset,
  type BuildPlan, type BuildRunState,
} from "../types";
import type { NodeFilters } from "../FiltersPanel";
import type { Thread } from "../threads";
import type { ReadmeStatus } from "../ReadmeBadge";
import type { ThreadSkillRecord, ArtifactRecordWire } from "../types";
import { buildLayout, buildProjectLayout, astEdgesToFlow, applyFilters } from "../layout";

// All the state App.tsx exposes to the message handler. Refs are mutable
// (the handler updates astNodesRef.current etc. directly), setters trigger
// re-renders.
export interface WebSocketHandlerActions {
  // mutable refs the handler writes to
  astNodesRef: React.MutableRefObject<AstNode[]>;
  symbolIndexRef: React.MutableRefObject<SymbolEntry[]>;
  projectDataRef: React.MutableRefObject<Record<string, ProjectFileData>>;

  // setters
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  // M26.2 — the app-wide selection. Each fresh envelope re-resolves the
  // selected node by structural id so post-edit consumers (editor panel,
  // compose anchor, thread eligibility) never act on a stale AstNode.
  setChatContextNode: React.Dispatch<React.SetStateAction<AstNode | null>>;
  setStubNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  // PLAN-v7 Stage 1 — the proposal overlay (sibling of the honest node state).
  setPendingProposal: React.Dispatch<React.SetStateAction<PendingProposal | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setComposeError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveFilePath: React.Dispatch<React.SetStateAction<string | null>>;
  setZoomLevel: React.Dispatch<React.SetStateAction<"project" | "file">>;

  // M4b wave 4 — thread view state.
  setThread: React.Dispatch<React.SetStateAction<Thread | null>>;
  setThreadError: React.Dispatch<React.SetStateAction<string | null>>;

  // M5 wave 2 — code view source.
  setFileSource: React.Dispatch<React.SetStateAction<string | null>>;
  setFileSourceError: React.Dispatch<React.SetStateAction<string | null>>;

  // M6 wave 1 — server-side feature flags (does the server have a
  // working Anthropic key? -- gates chat/analyze).
  setAnthropicAvailable: React.Dispatch<React.SetStateAction<boolean | null>>;

  // NEXT-ACTIONS §2 — project-warnings: third-party import roots the
  // analyzed project declares that aren't importable from .pydeps
  // (external-call resolution silently degrades without them).
  setMissingDeps: React.Dispatch<React.SetStateAction<{ module: string; files: string[] }[]>>;

  // M8.3.2 — envelope-level state surfaced from project-update.
  // entryPoints + threads ride the same payload as files; setters drive
  // the side panel and thread index re-render.
  setEntryPoints: React.Dispatch<React.SetStateAction<EntryPoint[]>>;
  setProjectThreads: React.Dispatch<React.SetStateAction<ProjectThread[]>>;
  // M19.1 — the system tier rides the same envelope (PLAN-v5 §1).
  setSystem: React.Dispatch<React.SetStateAction<SystemTier | null>>;
  // PLAN-v7 Stage 3 — the ratified plan (envelope sibling) + the pre-accept
  // pending proposal. Both SIBLINGS of the honest system tier; SystemView
  // composes honest + planned only at render.
  setSystemPlan: React.Dispatch<React.SetStateAction<SystemPlan | null>>;
  setPendingSystemPlan: React.Dispatch<React.SetStateAction<SystemPlan | null>>;
  // PLAN-v7 3b — directory mode, discriminated by receiving a project-update
  // envelope (only directory mode sends one). A blank greenfield directory
  // has zero files but is still a project.
  setProjectMode: React.Dispatch<React.SetStateAction<boolean>>;
  // PLAN-v7 Stage 4 — the pending build increment (changeset + floor).
  setPendingChangeset: React.Dispatch<React.SetStateAction<PendingChangeset | null>>;
  // PLAN-v7 Stage 5 — the roadmap (envelope sibling), its pending proposal,
  // and the orchestrator's live run dial.
  setBuildPlan: React.Dispatch<React.SetStateAction<BuildPlan | null>>;
  setPendingBuildPlan: React.Dispatch<React.SetStateAction<BuildPlan | null>>;
  setBuildRunState: React.Dispatch<React.SetStateAction<BuildRunState>>;
  // M26.4 — count of derived refreshes in flight (refreshDerived and the
  // watcher's full pass can overlap, so this is a counter, not a flag).
  // TopToolbar pulses while > 0.
  setRefreshesInFlight: React.Dispatch<React.SetStateAction<number>>;
  // M20.2 — README status for the active thread's badge.
  setReadmeStatus: React.Dispatch<React.SetStateAction<ReadmeStatus | null>>;
  // M-SKILL.3 — thread-skill lifecycle states, keyed by entryPointId.
  setThreadSkills: React.Dispatch<React.SetStateAction<Record<string, ThreadSkillRecord>>>;
  // M-TRAINED.2 — the artifact index (trained-ness as artifact state).
  setArtifacts: React.Dispatch<React.SetStateAction<ArtifactRecordWire[]>>;
  // setViewMode lets the handler default-to-index on first directory-mode
  // load. Caller decides what other transitions look like.
  setViewMode: React.Dispatch<React.SetStateAction<"index" | "diagram" | "thread" | "system" | "architecture">>;
}

export interface WebSocketHandlerDeps {
  zoomLevel: "project" | "file";
  activeFilePath: string | null;
  hiddenNodeIds: Set<string>;
  nodeFilters: NodeFilters;
}

// Subscribes to the singleton WS bridge for the lifetime of the consuming
// component and dispatches incoming protocol messages. Pure relocation of the
// useEffect that used to live in App.tsx — semantics must not change because
// the round-trip Playwright test pins the protocol behaviour.
export function useWebSocketHandler(actions: WebSocketHandlerActions, deps: WebSocketHandlerDeps): void {
  const {
    astNodesRef, symbolIndexRef, projectDataRef,
    setNodes, setEdges, setChatContextNode, setStubNodes, setPendingProposal, setError, setComposeError,
    setActiveFilePath, setZoomLevel, setThread, setThreadError,
    setFileSource, setFileSourceError, setAnthropicAvailable, setMissingDeps,
    setEntryPoints, setProjectThreads, setSystem, setSystemPlan,
    setPendingSystemPlan, setProjectMode, setPendingChangeset,
    setBuildPlan, setPendingBuildPlan, setBuildRunState, setRefreshesInFlight,
    setReadmeStatus, setThreadSkills, setArtifacts, setViewMode,
  } = actions;
  const { zoomLevel, activeFilePath, hiddenNodeIds, nodeFilters } = deps;

  useEffect(() => {
    const handler = (msg: any) => {
      if (msg.type === "ast-update") {
        const payload: AstPayload = msg.payload;
        astNodesRef.current = payload.nodes;
        symbolIndexRef.current = payload.symbolIndex ?? [];
        setActiveFilePath(payload.filePath);
        setZoomLevel("file");
        setNodes(buildLayout(
          applyFilters(payload.nodes, hiddenNodeIds, nodeFilters),
          (payload.edges ?? []).filter((e) => e.type === "reference"),
        ));
        setEdges(astEdgesToFlow(payload.edges ?? []));
        setError(null);
      } else if (msg.type === "project-update") {
        // M8.1+: payload is the v2.0 envelope; .files preserved at the
        // same key for backwards compat. M8.3.2 also reads entryPoints
        // + threads so the index + side panel can render.
        projectDataRef.current = msg.payload.files;
        setProjectMode(true); // an envelope arrived → directory mode, even with 0 files
        setEntryPoints(msg.payload.entryPoints ?? []);
        setProjectThreads(msg.payload.threads ?? []);
        setSystem(msg.payload.system ?? null);
        // PLAN-v7 Stage 3 — the ratified plan is an OPTIONAL envelope
        // sibling; absent field → no plan (clear any stale one).
        setSystemPlan(msg.payload.systemPlan ?? null);
        // PLAN-v7 Stage 5 — the roadmap rides the same way; every status
        // transition rebroadcasts, so this IS the live run progress.
        setBuildPlan(msg.payload.buildPlan ?? null);
        // M26.2 — re-resolve the selection against the fresh envelope.
        // Structural ids are file-scoped, so look in the active file
        // first; without one, rebind only on a project-unique hit (the
        // same id can legitimately exist in two files). Id gone → clear,
        // so nothing downstream edits a node that no longer exists.
        setChatContextNode((prev) => {
          if (!prev) return prev;
          const files: Record<string, ProjectFileData> = msg.payload.files ?? {};
          if (activeFilePath && files[activeFilePath]) {
            return files[activeFilePath].nodes.find((n) => n.id === prev.id) ?? null;
          }
          const hits = Object.values(files).flatMap(
            (fd) => fd.nodes.filter((n) => n.id === prev.id));
          return hits.length === 1 ? hits[0] : null;
        });
        if (zoomLevel === "project") {
          setNodes(buildProjectLayout(msg.payload.files));
          setEdges([]);
        } else if (activeFilePath && msg.payload.files[activeFilePath]) {
          const fd = msg.payload.files[activeFilePath];
          astNodesRef.current = fd.nodes;
          symbolIndexRef.current = fd.symbolIndex ?? [];
          setNodes(buildLayout(
            applyFilters(fd.nodes, hiddenNodeIds, nodeFilters),
            (fd.edges ?? []).filter((e) => e.type === "reference"),
          ));
          setEdges(astEdgesToFlow(fd.edges ?? []));
        } else {
          // M8.3.2: first load in directory mode now defaults to the
          // thread-index launchpad, not the project grid. Falls back to
          // project view only when the index is unusable (no entry
          // points discovered).
          //
          // PLAN-v7 3a fix (latent): this branch runs on EVERY envelope
          // rebroadcast when no file is open — a user sitting in the
          // system/thread/index view was yanked back to the index by any
          // re-parse or plan ratification. Only the initial "diagram"
          // state (pre-first-load) defaults to index; a deliberate view
          // choice survives envelope refreshes.
          if ((msg.payload.entryPoints ?? []).length > 0) {
            setViewMode((v) => (v === "diagram" ? "index" : v));
          } else {
            setZoomLevel("project");
            setNodes(buildProjectLayout(msg.payload.files));
            setEdges([]);
          }
        }
        setError(null);
      } else if (msg.type === "compose-done") {
        if (msg.payload.success) {
          setStubNodes([]);
          // PLAN-v7 Stage 1 — accept committed: drop the ghost overlay. The
          // real (post-link) node arrives via the follow-on project-update /
          // ast-update re-parse and takes over — re-parse is the truth.
          setPendingProposal(null);
          setComposeError(null);
        } else {
          setComposeError(msg.payload.message ?? "Insert failed");
        }
      } else if (msg.type === "compose-proposal") {
        // PLAN-v7 Stage 1 — dry-run preview reply. Hold it as a SIBLING
        // overlay; never merge into astNodesRef/projectDataRef. On !ok,
        // surface the reason (the op would have been rejected).
        if (msg.payload.ok && msg.payload.ghostNodes.length > 0) {
          setPendingProposal({
            ghostNodes: msg.payload.ghostNodes,
            mode: msg.payload.mode,
            anchorNodeId: msg.payload.anchorNodeId,
            filePath: msg.payload.filePath,
            source: msg.payload.source,
            drafted: msg.payload.drafted,
          });
          setComposeError(null);
        } else {
          setPendingProposal(null);
          setComposeError(msg.payload.error ?? "Nothing to propose");
        }
      } else if (msg.type === "system-proposal") {
        // PLAN-v7 Stage 3 — boundary-validated architecture proposal. Held
        // as a SIBLING overlay (pendingSystemPlan); never merged into the
        // honest system tier. !ok surfaces the validation reason.
        if (msg.payload.ok && msg.payload.plan) {
          setPendingSystemPlan(msg.payload.plan);
          setComposeError(null);
        } else {
          setPendingSystemPlan(null);
          setComposeError(msg.payload.error ?? "Invalid architecture proposal");
        }
      } else if (msg.type === "changeset-proposal") {
        // PLAN-v7 Stage 4 — the increment + its verification floor, held as
        // a SIBLING overlay. The gate enables acceptance only on floor.ok;
        // a failed floor still renders (honest decline with reasons).
        if (msg.payload.ok && msg.payload.changeset && msg.payload.floor) {
          setPendingChangeset({
            changeset: msg.payload.changeset,
            floor: msg.payload.floor,
            runItemId: msg.payload.runItemId,
          });
          setComposeError(null);
        } else {
          setPendingChangeset(null);
          setComposeError(msg.payload.error ?? "Invalid changeset");
        }
      } else if (msg.type === "changeset-done") {
        // PLAN-v7 Stage 4 — accept committed: files written through the
        // chokepoint. Drop the overlay; the follow-on envelope refresh
        // brings the parsed reality (threads appear, ghosts solidify).
        if (msg.payload.ok) {
          setPendingChangeset(null);
          setComposeError(null);
        } else {
          setComposeError(msg.payload.error ?? "Changeset build failed");
        }
      } else if (msg.type === "build-plan-proposal") {
        // PLAN-v7 Stage 5 — the roadmap proposal, held for ratification.
        if (msg.payload.ok && msg.payload.plan) {
          setPendingBuildPlan(msg.payload.plan);
          setComposeError(null);
        } else {
          setPendingBuildPlan(null);
          setComposeError(msg.payload.error ?? "Invalid roadmap proposal");
        }
      } else if (msg.type === "build-plan-saved") {
        if (msg.payload.ok) {
          setPendingBuildPlan(null);
          setComposeError(null);
        } else {
          setComposeError(msg.payload.error ?? "Roadmap ratification failed");
        }
      } else if (msg.type === "build-run-state") {
        setBuildRunState({
          active: msg.payload.active,
          runItemId: msg.payload.runItemId ?? null,
          note: msg.payload.note,
        });
      } else if (msg.type === "system-plan-saved") {
        // PLAN-v7 Stage 3 — accept committed: the plan is persisted; drop
        // the pending overlay. The follow-on project-update carries the
        // ratified plan as envelope.systemPlan, so the ghosts persist —
        // now from the durable artifact.
        if (msg.payload.ok) {
          setPendingSystemPlan(null);
          setComposeError(null);
        } else {
          setComposeError(msg.payload.error ?? "Plan ratification failed");
        }
      } else if (msg.type === "thread-update") {
        setThread(msg.payload.thread);
        setThreadError(null);
      } else if (msg.type === "thread-error") {
        setThread(null);
        setThreadError(msg.payload.message);
      } else if (msg.type === "file-source") {
        setFileSource(msg.payload.source);
        setFileSourceError(null);
      } else if (msg.type === "file-source-error") {
        setFileSource(null);
        setFileSourceError(msg.payload.message);
      } else if (msg.type === "graph-refresh") {
        // M26.4 — clamp at 0: a client that connects mid-refresh sees
        // the "done" without its "started".
        setRefreshesInFlight((n) =>
          Math.max(0, n + (msg.payload.state === "started" ? 1 : -1)));
      } else if (msg.type === "runtime-state") {
        setAnthropicAvailable(msg.payload.anthropicAvailable);
      } else if (msg.type === "project-warnings") {
        // NEXT-ACTIONS §2 — soft warnings; currently only missingDeps.
        setMissingDeps(msg.payload.missingDeps ?? []);
      } else if (msg.type === "readme-status") {
        // M20.2 — store the active thread's README state for the badge.
        setReadmeStatus(msg.payload);
      } else if (msg.type === "artifact-index") {
        // M-TRAINED.2 — repaint the artifact chip from the fresh index.
        setArtifacts(msg.payload.artifacts ?? []);
      } else if (msg.type === "thread-skills") {
        // M-SKILL.3 — full lifecycle listing (badges + launchpad dots).
        setThreadSkills(Object.fromEntries(
          msg.payload.skills.map((s: ThreadSkillRecord) => [s.entryPointId, s])));
      } else if (msg.type === "skill-sweep-progress") {
        // M-SKILL.4 — flip the launchpad dot live as each draft lands; the
        // canonical repaint follows via the post-sweep thread-skills reply.
        if (msg.payload.ok) {
          setThreadSkills((prev) => ({
            ...prev,
            [msg.payload.entryPointId]: { entryPointId: msg.payload.entryPointId, exists: true, status: "draft" },
          }));
        }
      } else if (msg.type === "thread-skill-status") {
        // M-SKILL.3 — single-thread update (ratify/redraft reply). A refusal
        // carries `error` with possibly no record fields — keep what we had
        // and surface the error rather than blanking the card.
        setThreadSkills((prev) => {
          const id = msg.payload.entryPointId;
          const base = msg.payload.exists !== undefined && !msg.payload.error
            ? msg.payload
            : { ...(prev[id] ?? { entryPointId: id, exists: false }), error: msg.payload.error };
          return { ...prev, [id]: base };
        });
      } else if (msg.type === "thread-run-result") {
        // M-RUN SM1 — re-broadcast as a DOM event so the per-node tooltip that
        // started the run can show the captured value + provenance, decoupled
        // from the App→ThreadView prop chain (same pattern as vg-* events).
        document.dispatchEvent(new CustomEvent("vg-thread-run-result", { detail: msg.payload }));
      } else if (msg.type === "thread-synth-proposal") {
        // M-RUN SM2.d — synthesized args proposed for confirm (no run yet).
        document.dispatchEvent(new CustomEvent("vg-thread-synth-proposal", { detail: msg.payload }));
      } else if (msg.type === "thread-data-proposal") {
        // M-RUN2.3 — drafted example data file proposed for consent (no write).
        document.dispatchEvent(new CustomEvent("vg-thread-data-proposal", { detail: msg.payload }));
      } else if (msg.type === "manual-seed-result") {
        // Sitting-2 — the pin's honest outcome (added / already-seeded /
        // not-seeded); App renders the transient notice.
        document.dispatchEvent(new CustomEvent("vg-manual-seed-result", { detail: msg.payload }));
      } else if (msg.type === "error") {
        setError(msg.payload.message);
      }
    };
    bridge.onMessage(handler);
    return () => bridge.removeListener(handler);
  }, [zoomLevel, activeFilePath, hiddenNodeIds, nodeFilters,
      astNodesRef, symbolIndexRef, projectDataRef,
      setNodes, setEdges, setChatContextNode, setStubNodes, setError, setComposeError,
      setActiveFilePath, setZoomLevel, setThread, setThreadError,
      setFileSource, setFileSourceError, setAnthropicAvailable,
      setEntryPoints, setProjectThreads, setSystem, setRefreshesInFlight,
      setReadmeStatus, setThreadSkills, setViewMode]);
}
