import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X, Eye, AlertCircle, Sparkles, Check } from "lucide-react";

import { ImportNode, ImportFromNode } from "./nodes/ImportNode";
import { AssignmentNode } from "./nodes/AssignmentNode";
import { FunctionDefNode } from "./nodes/FunctionDefNode";
import { ClassDefNode } from "./nodes/ClassDefNode";
import { ForLoopNode } from "./nodes/ForLoopNode";
import { IfNode } from "./nodes/IfNode";
import { ReturnNode } from "./nodes/ReturnNode";
import { RaiseNode } from "./nodes/RaiseNode";
import { CallNode } from "./nodes/CallNode";
import { StubNode } from "./nodes/StubNode";
import { GhostNode } from "./nodes/GhostNode";
import { ModuleNode } from "./nodes/ModuleNode";
import { MonacoOverlay } from "./MonacoOverlay";
// M25 chat revival — M10-chat-removal parked this panel on the thesis
// that the terminal MCP session replaces it; the user wants the agent
// conversation IN the GUI ("behave exactly like the VS Code terminal").
// It does: each message spawns `claude -p` with an inline MCP config
// pointing back at this server, so the panel and an external Claude
// Code session take the same code path. Single-function plain-language
// edits remain in NodeEditorPanel's Intent mode (M18.5).
import { ChatPanel } from "./ChatPanel";
import { GateButton } from "./controls/GateButton";
import { useAutoGrow } from "./useAutoGrow";
import { ComposePalette } from "./ComposePalette";
import { FiltersPanel, DEFAULT_FILTERS, type NodeFilters } from "./FiltersPanel";
import { ModelTiersPanel } from "./ModelTiersPanel";
import { DEFAULT_TIERS, sanitiseTiers, type TierSettings } from "../shared/model_tiers";

const MODEL_TIERS_KEY = "vg-model-tiers";
import { TopToolbar } from "./TopToolbar";
import { ChangesetGate } from "./ChangesetGate";
import { RoadmapPanel } from "./RoadmapPanel";
import { AnalysisCard } from "./AnalysisCard";
import { NodeExpandedOverlay } from "./NodeExpandedOverlay";
import { DiagramCanvas } from "./DiagramCanvas";
import { CodeView } from "./CodeView";
import { FloatingToggles } from "./FloatingToggle";
import { KeyBanner } from "./KeyBanner";
import { DepsBanner } from "./DepsBanner";
import {
  bridge,
  type AstNode,
  type SymbolEntry,
  type ProjectFileData,
  type EntryPoint,
  type ProjectThread,
  type SystemTier,
  type SystemPlan,
  type PendingChangeset,
  type BuildPlan,
  type BuildRunState,
  type ExtensionMessage,
  type PendingProposal,
} from "./types";
import { buildLayout, buildProjectLayout, basename, applyFilters } from "./layout";
import { useWebSocketHandler, useEventBus, useSelectionBus, type EditState } from "./messaging";
import { ViewTransition, MotionEdge, useNodeMotion } from "./motion";
import { ThreadView, ThreadIndex, ThreadContainerNode, SkillBadge, ThreadSkillCard, ArtifactChip, ArtifactCard, artifactsForThread, type Thread } from "./threads";
import type { ThreadSkillRecord, ArtifactRecordWire } from "./types";
import { SystemView } from "./system";
import { ArchitectureView, deriveModels, type ArchModel } from "./architecture";
import { ReadmeBadge, type ReadmeStatus } from "./ReadmeBadge";
import { ChipStrip } from "./ChipStrip";
// M18-Add-deprecate: the 9-kind Add palette + its drag/insertion flow is
// parked (superseded by Mode A "type code → Save → node appears"). Source
// files stay on disk (AddComponentKindPicker / AddComponentModal /
// InsertionPointPicker / useAddComponentDrag / insertionPoint); no live
// imports from this host. (M14-deprecate then deleted the gap-snapper, which
// was reachable only through this drag flow.)
import { SidePanel } from "./sidepanel";
import { NodeEditorPanel } from "./editor";

// ── React Flow node-type registry ─────────────────────────────────────────────

const nodeTypes = {
  importNode: ImportNode,
  importFromNode: ImportFromNode,
  assignmentNode: AssignmentNode,
  functionDefNode: FunctionDefNode,
  classDefNode: ClassDefNode,
  forLoopNode: ForLoopNode,
  ifNode: IfNode,
  returnNode: ReturnNode,
  raiseNode: RaiseNode,
  callNode: CallNode,
  stubNode: StubNode,
  ghostNode: GhostNode,
  moduleNode: ModuleNode,
  // try / finally regions in the file view reuse the thread-view container
  // shell (bordered region + chip) — see buildLayout.typeToNodeType.
  threadContainer: ThreadContainerNode,
};

const edgeTypes = {
  default: MotionEdge,
};

// ── graph component ───────────────────────────────────────────────────────────

type ZoomLevel = "project" | "file";

function Graph() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [stubNodes, setStubNodes] = useState<Node[]>([]);
  // PLAN-v7 Stage 1 — the proposal overlay. SIBLING of nodes/stubNodes; never
  // merged into astNodesRef/projectDataRef. Rendered as ghost nodes, cleared on
  // accept (compose-done) or reject.
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  // PLAN-v7 Stage 1b — the "Draft insert with Claude" affordance: draftOpen
  // toggles the minimal intent field; drafting is true while `claude -p` runs
  // (cleared when the compose-proposal / error arrives). draftIntent holds the
  // in-progress text.
  const [draftOpen, setDraftOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftIntent, setDraftIntent] = useState("");
  // PLAN-v7 Stage 3b — the "Describe" affordance: describeOpen toggles the
  // project-description field; describing is true while `claude -p` proposes
  // the architecture (cleared when the proposal / error arrives).
  const [describeOpen, setDescribeOpen] = useState(false);
  const [describing, setDescribing] = useState(false);
  // M-GF3.2 — the description in flight, for the drafting placeholder card.
  const [describingDesc, setDescribingDesc] = useState<string | null>(null);
  const [describeText, setDescribeText] = useState("");
  // PLAN-v7 Stage 4b — the "Build" affordance: buildOpen toggles the
  // capability field; building is true while the builder drafts + the floor
  // runs (cleared when the changeset proposal / error arrives).
  const [buildOpen, setBuildOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildText, setBuildText] = useState("");

  // 2026-08-04 — the three top-bar dialogs (Draft / Describe / Build) grow with
  // their content instead of clipping it. Describe gets the largest ceiling: it
  // takes a whole project brief, while Draft and Build take one capability.
  const describeGrow = useAutoGrow(describeText, describeOpen, 320);
  const draftGrow = useAutoGrow(draftIntent, draftOpen, 200);
  const buildGrow = useAutoGrow(buildText, buildOpen, 200);
  const [error, setError] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  // Beyond the chat itself this is the app-wide "selected node" context —
  // it drives thread eligibility, compose anchoring, CodeView highlight
  // and the editor panel.
  const [chatContextNode, setChatContextNode] = useState<AstNode | null>(null);
  const [chatFocusTrigger, setChatFocusTrigger] = useState(0);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());
  const [nodeFilters, setNodeFilters] = useState<NodeFilters>(DEFAULT_FILTERS);
  // Phase 2: which node (if any) is currently expanded as an overlay.
  // Only one at a time. Esc / scrim-click / chevron-on-same-node clears it.
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  // Model tiers live client-side and are pushed to the server, which is the
  // applier. Persisted so a reload doesn't silently revert to defaults —
  // and re-sent on mount, because the server resets to defaults on restart
  // and a stale UI claiming "Haiku" while Opus runs would be a lie.
  const [modelTiers, setModelTiers] = useState<TierSettings>(() => {
    try {
      const raw = window.localStorage.getItem(MODEL_TIERS_KEY);
      return raw ? sanitiseTiers(JSON.parse(raw)) : DEFAULT_TIERS;
    } catch { return DEFAULT_TIERS; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(MODEL_TIERS_KEY, JSON.stringify(modelTiers)); } catch { /* private mode */ }
    bridge.postMessage({ type: "set-model-tiers", payload: modelTiers });
  }, [modelTiers]);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("file");
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  // M4b wave 4 — thread view state. Thread is loaded on demand when the
  // user clicks the Thread button on the toolbar with a function selected.
  // M8.3.2 broadens viewMode to include "index" — the thread-index
  // launchpad that's now the default view in directory mode.
  const [viewMode, setViewMode] = useState<"index" | "diagram" | "thread" | "system" | "architecture">("diagram");
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [activeEntryPointId, setActiveEntryPointId] = useState<string | null>(null);
  // Chat-only: detach the conversation from the thread on screen so routing
  // can reach it like any other thread. Deliberately separate from
  // activeEntryPointId — clearing the chip must not navigate the canvas out
  // of the thread the user is reading.
  const [chatThreadDetached, setChatThreadDetached] = useState(false);
  useEffect(() => { setChatThreadDetached(false); }, [activeEntryPointId]);
  // M8.3.2 — entryPoints + threads from the project envelope, surfaced
  // by useWebSocketHandler. Drive the ThreadIndex launchpad and the
  // side panel's Threads tab.
  const [entryPoints, setEntryPoints] = useState<EntryPoint[]>([]);
  const [projectThreads, setProjectThreads] = useState<ProjectThread[]>([]);
  // M19.2 — the system tier (PLAN-v5 §1), surfaced from the same envelope.
  const [system, setSystem] = useState<SystemTier | null>(null);
  // PLAN-v7 3b — directory mode, discriminated by the PROTOCOL (only
  // directory mode ever sends a project-update envelope) instead of inferred
  // from file count: a BLANK directory (greenfield) has zero files but is
  // still a project — it must get the project surface (toolbar, side panel,
  // Describe), not the single-file "open a file" empty state.
  const [projectMode, setProjectMode] = useState(false);
  // PLAN-v7 Stage 3 — the architecture plan, in its two lifetimes: the
  // pre-accept pending proposal (webview-held overlay) and the ratified plan
  // (persisted server-side, rides the envelope). Both SIBLINGS of `system`,
  // composed only at render inside the system view.
  const [systemPlan, setSystemPlan] = useState<SystemPlan | null>(null);
  const [pendingSystemPlan, setPendingSystemPlan] = useState<SystemPlan | null>(null);
  // PLAN-v7 Stage 4 — the pending build increment (changeset + its
  // verification floor). SIBLING overlay; accept builds wet, reject drops.
  const [pendingChangeset, setPendingChangeset] = useState<PendingChangeset | null>(null);
  // PLAN-v7 Stage 5 — the roadmap (ratified, from the envelope) + its
  // pending proposal + the orchestrator's live run dial.
  const [buildPlan, setBuildPlan] = useState<BuildPlan | null>(null);
  const [pendingBuildPlan, setPendingBuildPlan] = useState<BuildPlan | null>(null);
  const [buildRunState, setBuildRunState] = useState<BuildRunState>({ active: false, runItemId: null });
  const [roadmapDrafting, setRoadmapDrafting] = useState(false);
  // M20.2 — README status for the active thread's badge (PLAN-v5 §2).
  const [readmeStatus, setReadmeStatus] = useState<ReadmeStatus | null>(null);
  // M-SKILL.3 — thread-skill lifecycle states (badge + card + launchpad dots).
  const [threadSkills, setThreadSkills] = useState<Record<string, ThreadSkillRecord>>({});
  // M-TRAINED.2 — the artifact index + card-open state.
  const [artifacts, setArtifacts] = useState<ArtifactRecordWire[]>([]);
  const [artifactCardOpen, setArtifactCardOpen] = useState(false);
  const [skillCardOpen, setSkillCardOpen] = useState(false);
  // M26.4 — server-side derived refreshes in flight (graph-refresh WS
  // events). The toolbar shows a muted "re-linking…" pulse while > 0.
  // On a small project the started→done window can be <100ms — a
  // flicker, not a signal — so once shown the chip holds for a minimum
  // readable beat. Still state-driven: it never outlives done + hold.
  const [refreshesInFlight, setRefreshesInFlight] = useState(0);
  const [refreshChipVisible, setRefreshChipVisible] = useState(false);
  const refreshChipShownAt = useRef(0);
  useEffect(() => {
    if (refreshesInFlight > 0) {
      refreshChipShownAt.current = Date.now();
      setRefreshChipVisible(true);
      return;
    }
    if (!refreshChipVisible) return;
    const MIN_VISIBLE_MS = 800;
    const remain = Math.max(0, MIN_VISIBLE_MS - (Date.now() - refreshChipShownAt.current));
    const t = window.setTimeout(() => setRefreshChipVisible(false), remain);
    return () => window.clearTimeout(t);
  }, [refreshesInFlight, refreshChipVisible]);
  // M5 wave 2 — code view state. The panel toggles open via the toolbar
  // Code button; source is requested per activeFilePath.
  const [codeOpen, setCodeOpen] = useState(false);
  const [fileSource, setFileSource] = useState<string | null>(null);
  const [fileSourceError, setFileSourceError] = useState<string | null>(null);
  // M18.1 — node editor panel. Opens via the toolbar Edit toggle or
  // auto-opens when the user clicks a node (the "code is the medium"
  // pivot). Loads the selected node's enclosing function; selection is
  // read from chatContextNode + activeFilePath, resolved inside the panel.
  const [editorOpen, setEditorOpen] = useState(false);
  // M6 wave 1 — server's feature flag for chat/analyze. null until the
  // first runtime-state message; once known, a banner surfaces when the
  // API key is missing instead of silently failing chat/analyze.
  const [anthropicAvailable, setAnthropicAvailable] = useState<boolean | null>(null);
  const [keyBannerDismissed, setKeyBannerDismissed] = useState(false);
  // NEXT-ACTIONS §2 — project-warnings: deps the analyzed project imports
  // that aren't importable from .pydeps. Dismissible like the key banner.
  const [missingDeps, setMissingDeps] = useState<{ module: string; files: string[] }[]>([]);
  const [depsBannerDismissed, setDepsBannerDismissed] = useState(false);

  const astNodesRef = useRef<AstNode[]>([]);
  const symbolIndexRef = useRef<SymbolEntry[]>([]);
  const projectDataRef = useRef<Record<string, ProjectFileData>>({});
  const nodesRef = useRef<Node[]>([]);

  // Keep nodesRef in sync for stub positioning
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // ── extension → webview message handling ──────────────────────────
  useWebSocketHandler(
    {
      astNodesRef, symbolIndexRef, projectDataRef,
      setNodes, setEdges, setChatContextNode, setStubNodes, setPendingProposal, setError, setComposeError,
      setActiveFilePath, setZoomLevel,
      setThread, setThreadError,
      setFileSource, setFileSourceError,
      setAnthropicAvailable,
      setMissingDeps,
      setEntryPoints, setProjectThreads, setSystem, setSystemPlan,
      setPendingSystemPlan, setProjectMode, setPendingChangeset,
      setBuildPlan, setPendingBuildPlan, setBuildRunState, setRefreshesInFlight,
      setReadmeStatus, setThreadSkills, setArtifacts, setViewMode,
    },
    { zoomLevel, activeFilePath, hiddenNodeIds, nodeFilters },
  );

  // Re-build layout when filters or hidden set change (without re-fetching).
  // Reference edges (carried on the converted edge data) drive the W2b
  // flow-ordering of the definitions band.
  useEffect(() => {
    if (zoomLevel !== "file") return;
    if (astNodesRef.current.length === 0) return;
    const refEdges = edges
      .filter((e) => (e.data as { kind?: string } | undefined)?.kind === "reference")
      .map((e) => ({ source: e.source, target: e.target }));
    setNodes(buildLayout(applyFilters(astNodesRef.current, hiddenNodeIds, nodeFilters), refEdges));
  }, [hiddenNodeIds, nodeFilters, zoomLevel, edges]);

  // ── document-level custom event bus (vg-* events) ─────────────────
  useEventBus(
    {
      astNodesRef, symbolIndexRef, projectDataRef,
      setEditState,
      setStubNodes, setPendingProposal, setPendingSystemPlan, setPendingChangeset, setPendingBuildPlan, setComposeError,
      setActiveFilePath, setZoomLevel, setNodes, setEdges, setHiddenNodeIds,
    },
    { activeFilePath, hiddenNodeIds, nodeFilters, pendingProposal, pendingSystemPlan, pendingChangeset, pendingBuildPlan },
  );

  // ── node click ────────────────────────────────────────────────────

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    const astNode = astNodesRef.current.find((n) => n.id === node.id);
    if (astNode) setChatContextNode(astNode);
    // M18.1 — auto-open the editor on a plain node click.
    if (astNode) setEditorOpen(true);
  };

  useSelectionBus(
    { astNodesRef, projectDataRef, setChatContextNode },
    { activeFilePath },
  );

  // M5 — code toggle + auto-refetch on file change.
  const codeEligible = activeFilePath != null && zoomLevel === "file";
  const handleToggleCode = useCallback(() => {
    if (codeOpen) { setCodeOpen(false); return; }
    if (!codeEligible || !activeFilePath) return;
    setFileSource(null); setFileSourceError(null); setCodeOpen(true);
    bridge.postMessage({ type: "get-file-source", payload: { filePath: activeFilePath } });
  }, [codeOpen, codeEligible, activeFilePath]);
  // Re-request source when the active file changes while the panel is open.
  useEffect(() => {
    if (!codeOpen || !activeFilePath) return;
    setFileSource(null); setFileSourceError(null);
    bridge.postMessage({ type: "get-file-source", payload: { filePath: activeFilePath } });
  }, [codeOpen, activeFilePath]);

  // M4b — thread toggle. Eligibility: a function_def is the active chat
  // context. Toolbar disables the button otherwise.
  const threadEligible = chatContextNode?.type === "function_def" && activeFilePath != null;
  const handleToggleThread = useCallback(() => {
    if (viewMode === "thread") { setViewMode("diagram"); return; }
    if (!threadEligible || !chatContextNode || !activeFilePath) return;
    setThread(null); setThreadError(null); setViewMode("thread");
    bridge.postMessage({ type: "extract-thread",
      payload: { filePath: activeFilePath, irNodeId: chatContextNode.id } });
  }, [viewMode, threadEligible, chatContextNode, activeFilePath]);

  // M19.2 — system view toggle. Discrete 4th view; always available in
  // directory mode (the system tier ships on the envelope). Toggles back
  // to diagram so the button reads as a switch, matching Thread.
  const handleToggleSystem = useCallback(() => {
    setViewMode((v) => (v === "system" ? "diagram" : "system"));
  }, []);

  // Architecture view (the 5th lens) — PyTorch nn.Module schematic. Toggles
  // back to diagram so the button reads as a switch, matching Thread/System.
  const handleToggleArchitecture = useCallback(() => {
    setViewMode((v) => (v === "architecture" ? "diagram" : "architecture"));
  }, []);

  // B — open a model's forward() as a data-path thread. Seeds the existing
  // on-demand extract-thread path with the method's IR node id (the extractor
  // walks a method body like any function); the thread reverts to the diagram
  // on toggle. No entry point needed — activeEntryPointId stays null.
  const handleOpenForward = useCallback((model: ArchModel) => {
    if (!model.forwardNodeId) return;
    setThread(null); setThreadError(null); setActiveEntryPointId(null);
    setActiveFilePath(model.file);
    setCodeOpen(false); // M-FS10 — same navigation rule as handleSelectEntry
    setViewMode("thread");
    bridge.postMessage({ type: "extract-thread",
      payload: { filePath: model.file, irNodeId: model.forwardNodeId } });
  }, []);

  // B — enrich a forward()-thread's `self.<attr>` terminals with their
  // declared layer type. The extractor leaves them as unlinked dynamic/
  // external terminals (no reference edge for class attributes); we map them
  // back to the __init__ declarations the architecture view already derived.
  // View-side, no extractor change; a no-op for non-forward threads.
  const enrichedThread = React.useMemo(() => {
    if (!thread || !thread.seed?.irNodeId) return thread;
    const model = deriveModels(projectDataRef.current).find(
      (m) => m.forwardNodeId != null && m.forwardNodeId === thread.seed.irNodeId,
    );
    if (!model) return thread;
    // attr → subtitle. Plain layers keep their declared type; an expanded
    // container (sitting-3) names its whole member chain — `self.net` reads
    // "Sequential — Linear(8, 64) → ReLU() → …", not a bare "Sequential"
    // that tells you nothing about what the call applies.
    const subtitleByAttr = new Map<string, string>();
    for (const l of model.layers) {
      if (l.container) {
        const piece = `${l.type}(${l.args.join(", ")})`;
        const prev = subtitleByAttr.get(l.container.attr);
        subtitleByAttr.set(
          l.container.attr,
          prev ? `${prev} → ${piece}` : `${l.container.type} — ${piece}`,
        );
      } else if (!subtitleByAttr.has(l.name)) {
        subtitleByAttr.set(l.name, l.type);
      }
    }
    let touched = false;
    const nodes = thread.nodes.map((n) => {
      const mt = /^self\.(\w+)$/.exec((n as { label?: string }).label ?? "");
      if (mt && subtitleByAttr.has(mt[1])) {
        touched = true;
        return { ...n, preview: subtitleByAttr.get(mt[1])! };
      }
      return n;
    });
    return touched ? { ...thread, nodes } : thread;
  }, [thread]);

  // M8.3.2 — entry-point click in the launchpad / side panel. The
  // envelope already shipped every thread, so no server round-trip;
  // we cast the ProjectThread to the ThreadView's Thread shape (extra
  // entryPointId/filesReached fields are ignored by the renderer).
  const handleSelectEntry = useCallback((entry: EntryPoint) => {
    const t = projectThreads.find((t) => t.entryPointId === entry.id);
    if (!t) {
      setThreadError(`No thread extracted for ${entry.qualifiedName}`);
      setViewMode("thread");
      return;
    }
    setThread(t as unknown as Thread);
    setThreadError(null);
    setActiveEntryPointId(entry.id);
    setActiveFilePath(entry.file);
    // M-FS10 (full-scope review P3) — opening a DIFFERENT thread is a
    // navigation: a code dock left over from earlier context squeezed
    // the fresh thread into a sliver (one node click later: three
    // panels, dead-sliver breadcrumb). The in-thread side-by-side flow
    // (open dock WHILE reading a thread, M18-r1) is untouched.
    setCodeOpen(false);
    setViewMode("thread");
  }, [projectThreads]);

  // M18.3 — keep the open thread live after an edit. A Mode A save
  // re-parses + re-extracts on the server and rebroadcasts the envelope
  // (→ projectThreads); re-derive the displayed thread from the freshest
  // copy so the new/changed node animates in via node-enter.
  useEffect(() => {
    if (viewMode !== "thread" || !activeEntryPointId) return;
    const fresh = projectThreads.find((t) => t.entryPointId === activeEntryPointId);
    if (fresh) setThread(fresh as unknown as Thread);
  }, [projectThreads, activeEntryPointId, viewMode]);

  // R-1a — keep the open CodeView live after a save, the same way the
  // graph views are. CodeView renders raw file *text*, not IR, so the
  // envelope rebroadcast that refreshes nodes/edges/threads (→ projectThreads)
  // leaves it stale. Re-request the source for the open file whenever a
  // fresh envelope lands. No setFileSource(null) here: swapping in place
  // avoids a "Loading…" flash on every save (the navigation effect above
  // clears deliberately; this one updates smoothly). Deps are narrowed to
  // projectThreads on purpose — this fires only on a new envelope, never on
  // open/navigation, which the effect above already handles.
  useEffect(() => {
    if (!codeOpen || !activeFilePath) return;
    bridge.postMessage({ type: "get-file-source", payload: { filePath: activeFilePath } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectThreads]);

  // Side-by-side docks (refinement #1/#3, model A). When CodeView and the
  // editor are both open, tile them into two equal right-edge columns so
  // neither occludes the other and the thread/diagram canvas stays visible
  // on the left. Solo → the original full-width right dock. minWidth is 0
  // when co-open so the two percentage columns align exactly (a px minWidth
  // would desync the offset from the width and let them overlap again).
  //
  // M28.3 — the Claude chat is docked PERMANENTLY at the bottom of this
  // right-side region (always present while a code panel is open — no
  // toggle). The panels above reserve NODE_CHAT_H via `bottom` so they
  // never overlap it; the chat spans the region's width. When no code
  // panel is open the chat falls back to the full-width bottom bar driven
  // by the floating toggle (project-level conversation from the canvas).
  const NODE_CHAT_H = 300;
  const panelsCoOpen = codeOpen && editorOpen;
  const regionOpen = editorOpen || codeOpen;
  // Width of the right-side region the docked chat spans.
  const regionWidth = panelsCoOpen ? "66%" : "max(44%, 480px)";
  const editorDock = panelsCoOpen
    ? { right: 0, width: "33%", minWidth: 0, bottom: NODE_CHAT_H }
    : { right: 0, width: "44%", minWidth: 480, bottom: NODE_CHAT_H };
  const codeDock = panelsCoOpen
    ? { right: "33%", width: "33%", minWidth: 0, bottom: NODE_CHAT_H }
    : { right: 0, width: "44%", minWidth: 480, bottom: NODE_CHAT_H };
  // Docked-in-region chat geometry (right-anchored, region width, fixed
  // height). undefined → ChatPanel uses its full-width bottom-bar layout.
  const chatDock = regionOpen
    ? { left: "auto" as const, right: 0, width: regionWidth, height: NODE_CHAT_H }
    : undefined;
  // The full-width bottom chat only shows when no code panel is open;
  // floating controls / overlays lift above it in that case alone.
  const fullWidthChat = chatOpen && !regionOpen;

  // File-tree click. Re-uses the M4b vg-zoom-to-file event so existing
  // event-bus consumers (selection sync, breadcrumb) update too.
  const handleSelectFile = useCallback((filePath: string) => {
    setViewMode("diagram");
    setActiveEntryPointId(null);
    document.dispatchEvent(new CustomEvent("vg-zoom-to-file",
      { detail: { filePath } }));
  }, []);

  // W2 — a node's "Open source file" button opens the node's file in the
  // file/diagram view (its whole-file context in the sidebar), instead of a
  // floating full-file panel that fights the pinned node card. Reuses
  // handleSelectFile; a distinct event so it doesn't loop with vg-zoom-to-file.
  useEffect(() => {
    const handler = (e: Event) => {
      const fp = (e as CustomEvent<{ filePath?: string }>).detail?.filePath;
      if (fp) handleSelectFile(fp);
    };
    document.addEventListener("vg-open-source-file", handler);
    return () => document.removeEventListener("vg-open-source-file", handler);
  }, [handleSelectFile]);

  // ── expand-node listener (Phase 2 chevron) ────────────────────────
  // Toggle: clicking expand on the same node clears it; clicking expand
  // on a different node switches. Esc / scrim handle close from inside
  // the overlay.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.nodeId;
      if (!id) return;
      setExpandedNodeId((prev) => (prev === id ? null : id));
    };
    document.addEventListener("vg-expand-node", handler);
    return () => document.removeEventListener("vg-expand-node", handler);
  }, []);

  // ── M18.1 auto-open editor on user selection ──────────────────────
  // Thread / code-view clicks publish vg-selection; open the editor for
  // those user-driven selections. Skip server-driven ("external") MCP
  // selections so a remote driver doesn't pop the panel. (Diagram clicks
  // open via handleNodeClick — they don't go through vg-selection.)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { source?: string } | undefined;
      if (!detail || detail.source === "external") return;
      setEditorOpen(true);
    };
    document.addEventListener("vg-selection", handler);
    return () => document.removeEventListener("vg-selection", handler);
  }, []);

  // M28.3 — opening a code panel surfaces the chat docked beneath it with no
  // extra click. We track that the *region* (not the star toggle) opened the
  // chat: when the code panel later closes, a region-opened chat retracts
  // instead of popping back as the full-width bottom bar. A chat the user
  // opened via the star toggle is theirs and stays. Edge-triggered on
  // regionOpen so closing the chat by hand while a panel is open doesn't get
  // re-opened. The server-side session (M27) keeps conversation memory across
  // the retract — reopening resumes it with the honesty note.
  // Sitting-2 — "Ask Claude about this error" (failed-run card) prefills the
  // chat; the panel must be OPEN to receive it. Open + bump focus; the
  // ChatPanel's own vg-chat-prefill listener fills the input (prefill only —
  // the human reviews and sends).
  const [chatPrefill, setChatPrefill] = useState<{ text: string; seq: number } | null>(null);
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof text !== "string" || !text.trim()) return;
      setChatPrefill((p) => ({ text, seq: (p?.seq ?? 0) + 1 }));
      setChatOpen(true);
      setChatFocusTrigger((n) => n + 1);
    };
    document.addEventListener("vg-chat-prefill", onPrefill);
    return () => document.removeEventListener("vg-chat-prefill", onPrefill);
  }, []);

  const chatFromRegion = useRef(false);
  const prevRegionOpen = useRef(false);
  useEffect(() => {
    const opened = regionOpen && !prevRegionOpen.current;
    const closed = !regionOpen && prevRegionOpen.current;
    prevRegionOpen.current = regionOpen;
    if (opened) {
      if (!chatOpen) {
        chatFromRegion.current = true;
        setChatOpen(true);
      }
    } else if (closed && chatFromRegion.current) {
      chatFromRegion.current = false;
      setChatOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionOpen]);

  const expandedAstNode = expandedNodeId
    ? astNodesRef.current.find((n) => n.id === expandedNodeId) ?? null
    : null;

  // ── stub node creation ────────────────────────────────────────────

  const handleAddStub = useCallback((constructType: string, source: string) => {
    const stubId = `stub-${Date.now()}`;
    const anchorNodeId = chatContextNode?.id ?? null;
    const insertMode: "insert_after" | "append_end" = anchorNodeId ? "insert_after" : "append_end";
    const anchor = anchorNodeId ? nodesRef.current.find((n) => n.id === anchorNodeId) : null;
    const baseX = anchor ? anchor.position.x + ((anchor.style?.width as number) ?? 260) + 40 : 100;
    const baseY = anchor ? anchor.position.y : 40;
    const offset = stubNodes.length;
    setStubNodes((prev) => [
      ...prev,
      {
        id: stubId,
        type: "stubNode",
        position: { x: baseX + offset * 10, y: baseY + offset * 36 },
        data: {
          stubId,
          constructType,
          sourcePreview: source,
          source,
          anchorNodeId,
          insertMode,
          filePath: activeFilePath ?? undefined,
        },
        draggable: true,
        style: { width: 260 },
      },
    ]);
    setComposeError(null);
  }, [chatContextNode, stubNodes.length, activeFilePath]);

  // PLAN-v7 Stage 1b — submit the plain-language intent. Anchor on the
  // selected node (insert_after) when there is one, else append to the active
  // file. The server drafts via `claude -p`, then feeds the draft to the SAME
  // 1a propose path; the drafted ghost arrives as a compose-proposal.
  const handleDraftSubmit = useCallback(() => {
    const intent = draftIntent.trim();
    if (!intent) return;
    const anchorNodeId = chatContextNode?.id ?? null;
    const insertMode: "insert_after" | "append_end" = anchorNodeId ? "insert_after" : "append_end";
    setDrafting(true);
    setComposeError(null);
    bridge.postMessage({
      type: "compose-propose-intent",
      payload: { intent, mode: insertMode, anchorNodeId, filePath: activeFilePath ?? undefined },
    });
    setDraftIntent("");
    setDraftOpen(false);
  }, [draftIntent, chatContextNode, activeFilePath]);

  // Clear the drafting spinner once the round-trip resolves — either a ghost
  // proposal landed or the server declined (composeError). The event bus owns
  // both setters; this just releases the toolbar's pending state.
  useEffect(() => {
    if (drafting && (pendingProposal || composeError)) setDrafting(false);
  }, [drafting, pendingProposal, composeError]);

  // PLAN-v7 Stage 3b — submit the project description. The server drafts an
  // architecture via `claude -p` (grounding-enforced) and replies with the
  // same system-proposal the canned 3a path uses.
  const handleDescribeSubmit = useCallback(() => {
    const description = describeText.trim();
    if (!description) return;
    setDescribing(true);
    setDescribingDesc(description);
    setComposeError(null);
    bridge.postMessage({ type: "system-propose-intent", payload: { description } });
    setDescribeText("");
    setDescribeOpen(false);
    // M-GF3.2 — jump to the system view NOW, not when the proposal lands:
    // the drafting placeholder animates where the ghosts will appear.
    setViewMode("system");
  }, [describeText]);

  useEffect(() => {
    if (describing && (pendingSystemPlan || composeError)) {
      setDescribing(false);
      setDescribingDesc(null);
    }
  }, [describing, pendingSystemPlan, composeError]);

  // A newly-arrived architecture proposal is decided in the system view —
  // jump there so the ghosts are seen, not ratified blind.
  useEffect(() => {
    if (pendingSystemPlan) setViewMode("system");
  }, [pendingSystemPlan]);

  // PLAN-v7 Stage 4b — submit the capability. The builder drafts an
  // increment toward the ratified plan; the full floor runs; the changeset
  // gate arrives as a changeset-proposal (same shape as the canned path).
  const handleBuildSubmit = useCallback(() => {
    const intent = buildText.trim();
    if (!intent) return;
    setBuilding(true);
    setComposeError(null);
    bridge.postMessage({ type: "changeset-propose-intent", payload: { intent } });
    setBuildText("");
    setBuildOpen(false);
  }, [buildText]);

  useEffect(() => {
    if (building && (pendingChangeset || composeError)) setBuilding(false);
  }, [building, pendingChangeset, composeError]);

  // PLAN-v7 Stage 5 — the roadmap draft trigger: post the intent + track
  // the in-flight flag; released when the proposal (or error) arrives.
  // M-GF3.5 — with guidance this is a REVISE of the pending proposal: the
  // previous draft rides along for the drafter, and the superseded pending
  // plan clears so the drafting skeleton (not the stale draft) shows.
  const handleDraftRoadmap = useCallback((guidance?: string) => {
    setRoadmapDrafting(true);
    setComposeError(null);
    const previous = pendingBuildPlan ?? undefined;
    if (guidance) setPendingBuildPlan(null);
    bridge.postMessage({
      type: "build-plan-propose-intent",
      payload: guidance ? { guidance, previous } : {},
    });
  }, [pendingBuildPlan]);
  useEffect(() => {
    if (roadmapDrafting && (pendingBuildPlan || composeError)) setRoadmapDrafting(false);
  }, [roadmapDrafting, pendingBuildPlan, composeError]);

  // Sitting-2 — "Approve & draft roadmap": the architecture gate's primary
  // action chains into the roadmap draft, so the flow doesn't teleport from
  // the top-center gate to a bottom-left button the user must find. The
  // draft fires only AFTER the ratified plan lands (systemPlan non-null) —
  // client-side sequencing, so the server never sees a draft request racing
  // its own ratification. Roadmap ratification stays its own human gate.
  const draftAfterApprove = useRef(false);
  useEffect(() => {
    if (systemPlan != null && draftAfterApprove.current) {
      draftAfterApprove.current = false;
      if (!buildPlan && !pendingBuildPlan && !roadmapDrafting) handleDraftRoadmap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemPlan]);

  // ── breadcrumb (project → file) ───────────────────────────────────

  const goToProjectView = useCallback(() => {
    setZoomLevel("project");
    setNodes(buildProjectLayout(projectDataRef.current));
    setEdges([]);
    setStubNodes([]);
  }, []);

  // ── M19.3 — system-view drill-down (PLAN-v5 §1.4) ─────────────────
  // Threads ARE the system, zoomed in: an endpoint row or an effect edge
  // opens the thread it rolled up from. Reuses handleSelectEntry, then
  // publishes vg-selection so code/diagram + MCP clients sync.
  const handleOpenThreadById = useCallback((entryPointId: string) => {
    const ep = entryPoints.find((e) => e.id === entryPointId);
    if (!ep) return;
    handleSelectEntry(ep);
    document.dispatchEvent(new CustomEvent("vg-selection", {
      detail: { filePath: ep.file, irNodeId: ep.irNodeId, source: "system" },
    }));
  }, [entryPoints, handleSelectEntry]);

  // Click a subsystem card → drill into its code in the diagram. A derived
  // subsystem (db / cache / external_http) jumps to the file of its first
  // effect ref; backend / library / frontend go to the project diagram.
  const handleSelectSubsystem = useCallback((subsystemId: string) => {
    const sub = system?.subsystems.find((s) => s.id === subsystemId);
    if (!sub) return;
    if (sub.kind === "db" || sub.kind === "cache" || sub.kind === "external_http") {
      const ref = (system?.edges ?? []).find((e) => e.kind === "effect" && e.to === subsystemId)?.refs[0];
      const file = ref?.split(":")[0];
      if (file) { handleSelectFile(file); return; }
    }
    setViewMode("diagram");
    goToProjectView();
  }, [system, handleSelectFile, goToProjectView]);

  // M20.2 — fetch the active thread's README status (pull-on-demand) when
  // the thread view opens or the thread changes. The badge renders the
  // result; generation stays on-request (the Refresh button).
  useEffect(() => {
    if (viewMode !== "thread" || !activeEntryPointId) { setReadmeStatus(null); return; }
    setReadmeStatus(null);
    bridge.postMessage({ type: "get-readme", payload: { scope: "thread", id: activeEntryPointId } });
  }, [viewMode, activeEntryPointId]);

  const handleRefreshReadme = useCallback(() => {
    if (!activeEntryPointId) return;
    setReadmeStatus({ exists: false, generating: true });
    bridge.postMessage({ type: "generate-readme", payload: { scope: "thread", id: activeEntryPointId } });
  }, [activeEntryPointId]);

  // M-SKILL.3 — pull every thread's skill state whenever the entry-point set
  // changes (boot + each project re-parse): the launchpad dots and the badge
  // both read from this one map.
  useEffect(() => {
    if (entryPoints.length > 0) {
      bridge.postMessage({ type: "get-thread-skills", payload: {} });
      // M-TRAINED.2 — artifact state repaints on the same cadence.
      bridge.postMessage({ type: "get-artifact-index", payload: {} });
    }
  }, [entryPoints]);

  // Close the skill card when the thread (or view) changes under it.
  useEffect(() => { setSkillCardOpen(false); setArtifactCardOpen(false); }, [activeEntryPointId, viewMode]);

  // M-TRAINED.2 — "Open producer thread" from the artifact card (and any
  // future surface): navigate to a thread by entryPointId via a DOM event,
  // the same decoupling the vg-* run events use.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail as { entryPointId?: string };
      const entry = entryPoints.find((ep) => ep.id === d?.entryPointId);
      if (entry) { setArtifactCardOpen(false); handleSelectEntry(entry); }
    };
    document.addEventListener("vg-open-thread", onOpen);
    return () => document.removeEventListener("vg-open-thread", onOpen);
  }, [entryPoints, handleSelectEntry]);

  // Sitting-2 — the pin's outcome notice. The pin used to be silent from
  // the file view (its only visible result was a launchpad row in ANOTHER
  // view — and none at all when the function was already seeded). Transient,
  // with "Open thread" as the useful next step; auto-dismisses.
  const [seedNotice, setSeedNotice] = useState<{
    outcome: "added" | "already-seeded" | "not-seeded";
    entryPointId: string | null;
    qualifiedName: string | null;
    kind: string | null;
  } | null>(null);
  useEffect(() => {
    const onSeed = (e: Event) => {
      const d = (e as CustomEvent).detail as typeof seedNotice & { irNodeId: string };
      if (d) setSeedNotice({ outcome: d.outcome, entryPointId: d.entryPointId, qualifiedName: d.qualifiedName, kind: d.kind });
    };
    document.addEventListener("vg-manual-seed-result", onSeed);
    return () => document.removeEventListener("vg-manual-seed-result", onSeed);
  }, []);
  useEffect(() => {
    if (!seedNotice) return;
    const t = setTimeout(() => setSeedNotice(null), 8000);
    return () => clearTimeout(t);
  }, [seedNotice]);

  // ── render ────────────────────────────────────────────────────────
  // Hooks must run on every render, before any early returns. Compute the
  // motion-decorated nodes here so the order of hooks is stable.
  // PLAN-v7 Stage 1 — the proposal overlay as react-flow ghost node(s), placed
  // at the REAL semantic insertion spot: right below the anchor in its column,
  // connected by an edge, with the same-column siblings below it nudged down to
  // reserve space (previewing the reflow the accepted write will produce). A
  // SIBLING layer — never merged into astNodesRef/projectDataRef, so the honest
  // IR stays honest until accept. Ghost ids are `ghost:`-prefixed so they can't
  // collide with the real (post-link) node the re-parse brings in.
  const GHOST_H = 118;
  const GHOST_GAP = 28;
  const proposalLayout = React.useMemo<{ shiftedNodes: Node[]; ghostFlowNodes: Node[]; ghostEdge: Edge | null }>(() => {
    const makeGhost = (g: { id: string; label: string; type: string }, x: number, y: number): Node => ({
      id: `ghost:${g.id}`, type: "ghostNode", position: { x, y },
      data: { label: g.label, kindType: g.type, drafted: pendingProposal?.drafted },
      draggable: false, selectable: false, width: 248,
    });
    if (!pendingProposal) return { shiftedNodes: nodes, ghostFlowNodes: [], ghostEdge: null };
    const anchor = pendingProposal.anchorNodeId
      ? nodes.find((n) => n.id === pendingProposal.anchorNodeId && !(n as any).parentId)
      : null;
    if (!anchor) {
      // No top-level anchor in view — place clear at top-left, no reflow.
      return {
        shiftedNodes: nodes,
        ghostFlowNodes: pendingProposal.ghostNodes.map((g, i) => makeGhost(g, 60, 60 + i * (GHOST_H + GHOST_GAP))),
        ghostEdge: null,
      };
    }
    const anchorH = (anchor.height as number) ?? 80;
    const ghostY = anchor.position.y + anchorH + GHOST_GAP;
    const shift = GHOST_H + GHOST_GAP;
    // reserve space: nudge same-column top-level siblings below the anchor down.
    const shiftedNodes = nodes.map((n) =>
      (!(n as any).parentId && n.id !== anchor.id
        && Math.abs(n.position.x - anchor.position.x) < 1
        && n.position.y > anchor.position.y)
        ? { ...n, position: { ...n.position, y: n.position.y + shift } }
        : n);
    const ghostFlowNodes = pendingProposal.ghostNodes.map((g, i) =>
      makeGhost(g, anchor.position.x, ghostY + i * (GHOST_H + GHOST_GAP)));
    const ghostEdge: Edge | null = ghostFlowNodes[0]
      ? {
          id: "ghost-edge", source: anchor.id, target: ghostFlowNodes[0].id,
          type: "default", data: { family: "flow" },
          style: { stroke: "var(--proposed-border)", strokeWidth: 1.5, strokeDasharray: "5 4" },
        }
      : null;
    return { shiftedNodes, ghostFlowNodes, ghostEdge };
  }, [pendingProposal, nodes]);
  const ghostFlowNodes = proposalLayout.ghostFlowNodes;

  const allNodes = [...proposalLayout.shiftedNodes, ...stubNodes, ...ghostFlowNodes];
  const { decoratedNodes, exitGhosts } = useNodeMotion(allNodes);

  // M-FV.3 (W3) — edges are hidden by default; the Filters panel's edge
  // toggles reveal the flow (call/reference) and/or structure (contains)
  // families. Filter by the family stamped on each edge's data.
  // What the flow toggle can actually draw for this file, so the panel can
  // say so. An edge whose target node is not in the current graph is dropped
  // by react-flow with no trace — on a single-file view that is every
  // cross-file call, which is most of the interesting flow.
  const flowStats = React.useMemo(() => {
    const present = new Set(nodes.map((n) => n.id));
    let drawable = 0, offFile = 0;
    for (const e of edges) {
      const fam = (e.data as { family?: string } | undefined)?.family;
      if (fam === "structure") continue;
      if (present.has(e.source) && present.has(e.target)) drawable++;
      else offFile++;
    }
    return { drawable, offFile };
  }, [edges, nodes]);

  const displayedEdges = React.useMemo(
    () => {
      const base = edges.filter((e) => {
        const fam = (e.data as { family?: string } | undefined)?.family;
        if (fam === "flow") return nodeFilters.showFlowEdges;
        if (fam === "structure") return nodeFilters.showStructureEdges;
        return nodeFilters.showFlowEdges; // unfamilied → treat as flow
      });
      // PLAN-v7 Stage 1 — the ghost's anchor edge is a proposal indicator
      // ("this lands HERE"), not a normal flow/reference edge, so it's always
      // shown regardless of the edge-family toggles.
      if (proposalLayout.ghostEdge) base.push(proposalLayout.ghostEdge);
      return base;
    },
    [edges, nodeFilters.showFlowEdges, nodeFilters.showStructureEdges, proposalLayout.ghostEdge],
  );

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--accent-error)", fontSize: "var(--fs-14)", padding: 20 }}>
        {error}
      </div>
    );
  }

  // M8.3.2: directory-mode UI surface — side panel always visible, main
  // canvas swaps between index / thread / diagram. Single-file mode keeps
  // the legacy "open a file" empty state.
  // projectMode (protocol-discriminated) OR file-count — the ref mutates
  // without a re-render, so the legacy clause preserves existing timing.
  const isDirectoryMode = projectMode || Object.keys(projectDataRef.current).length > 0;
  // Architecture lens is offered only when the project actually has a PyTorch
  // model (an nn.Module subclass) — derived from the same per-file IR the view
  // renders. Cheap for these projects; recomputed on each envelope re-render.
  const architectureAvailable = isDirectoryMode && deriveModels(projectDataRef.current).length > 0;
  const isEmpty = nodes.length === 0 && stubNodes.length === 0 && ghostFlowNodes.length === 0;
  if (isEmpty && !isDirectoryMode && viewMode !== "index" && viewMode !== "thread" && viewMode !== "system") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-secondary)", fontSize: "var(--fs-14)", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 32 }}>~</div>
        <div>Open a Python file to see its graph</div>
      </div>
    );
  }

  const chatContextLabel = chatContextNode
    ? (chatContextNode as any).name ??
      (chatContextNode as any).funcName ??
      (chatContextNode as any).target ??
      chatContextNode.type
    : null;

  return (
    <>
      {/* M8.3.2 — side panel: always visible in directory mode. */}
      {isDirectoryMode && (
        <SidePanel
          entryPoints={entryPoints}
          threads={projectThreads}
          filePaths={Object.keys(projectDataRef.current)}
          activeFilePath={activeFilePath}
          activeEntryPointId={activeEntryPointId}
          onSelectEntry={handleSelectEntry}
          onSelectFile={handleSelectFile}
        />
      )}

      <div style={{ marginLeft: isDirectoryMode ? 280 : 0, height: "100%" }}>
        {viewMode === "index" ? (
          <ThreadIndex
            entryPoints={entryPoints}
            threads={projectThreads}
            threadSkills={threadSkills}
            onSelectEntry={handleSelectEntry}
          />
        ) : viewMode === "system" ? (
          <SystemView
            system={system}
            // PLAN-v7 Stage 3 — the pending proposal previews over the
            // ratified plan (you're deciding on the new one); otherwise the
            // durable ratified plan ghosts persist until built.
            plan={pendingSystemPlan ?? systemPlan}
            threads={projectThreads}
            entryPoints={entryPoints}
            onOpenThread={handleOpenThreadById}
            onSelectSubsystem={handleSelectSubsystem}
            draftingDescription={describing ? describingDesc : null}
          />
        ) : viewMode === "architecture" ? (
          <ArchitectureView projectIR={projectDataRef.current} onOpenForward={handleOpenForward} />
        ) : viewMode === "diagram" ? (
          <DiagramCanvas
            nodes={decoratedNodes}
            edges={displayedEdges}
            exitGhosts={exitGhosts}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            composeOpen={composeOpen}
            hideMinimap={codeOpen || editorOpen}
            onNodeClick={handleNodeClick}
          />
        ) : thread ? (
          <>
            <ThreadView
              thread={enrichedThread ?? thread}
              projectIR={projectDataRef.current}
              entryPoints={entryPoints}
              editorOpen={editorOpen}
              codeOpen={codeOpen}
            />
            {/* M28.3 — README generation is an OVERALL-thread action, not a
                per-node one. Hide the badge while a code panel is focused on
                a single node (editor / code view open); it returns when you
                step back to the whole thread. */}
            {!regionOpen && (
              <ChipStrip>
                <ReadmeBadge status={readmeStatus} onRefresh={handleRefreshReadme} />
                {/* M-SKILL.3 — skill lifecycle chip, sibling to the README badge. */}
                {activeEntryPointId && (
                  <SkillBadge
                    record={threadSkills[activeEntryPointId] ?? null}
                    onOpen={() => setSkillCardOpen(true)}
                  />
                )}
                {/* M-TRAINED.2 — artifact chip, third in the cluster. */}
                {activeEntryPointId && (
                  <ArtifactChip
                    records={artifactsForThread(artifacts, activeEntryPointId)}
                    onOpen={() => setArtifactCardOpen(true)}
                  />
                )}
              </ChipStrip>
            )}
            {artifactCardOpen && activeEntryPointId && (
              <ArtifactCard
                records={artifactsForThread(artifacts, activeEntryPointId)}
                activeEntryPointId={activeEntryPointId}
                onOpenThread={(entryPointId) =>
                  document.dispatchEvent(new CustomEvent("vg-open-thread", { detail: { entryPointId } }))}
                onClose={() => setArtifactCardOpen(false)}
              />
            )}
            {skillCardOpen && activeEntryPointId && (
              <ThreadSkillCard
                entryPointId={activeEntryPointId}
                qualifiedName={entryPoints.find((e) => e.id === activeEntryPointId)?.qualifiedName ?? activeEntryPointId}
                record={threadSkills[activeEntryPointId] ?? null}
                onClose={() => setSkillCardOpen(false)}
              />
            )}
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-secondary)", fontSize: "var(--fs-14)", fontFamily: "var(--font-mono)" }}>
            {threadError ?? "Tracing thread…"}
          </div>
        )}
      </div>

      {/* ── Breadcrumb (Stage 5: project → file) ── */}
      {/* M8.3.3: in directory mode the side panel takes 280px on the
          left, so the breadcrumb has to shift past it or it'll overlap
          the panel toggles and intercept their clicks. */}
      {zoomLevel === "file" && Object.keys(projectDataRef.current).length > 0 && (
        <div
          style={{
            position: "fixed",
            top: 10,
            left: composeOpen ? 528 : (isDirectoryMode ? 298 : 18),
            zIndex: 850,
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--bg-canvas)",
            border: "1px solid var(--border-edge)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: "var(--fs-11)",
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            transition: "left 0.18s ease",
          }}
        >
          <button
            onClick={goToProjectView}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent-thread)",
              cursor: "pointer",
              fontSize: "var(--fs-11)",
              padding: 0,
              fontFamily: "var(--font-mono)",
              textDecoration: "underline",
            }}
          >
            project
          </button>
          <span>›</span>
          <span style={{ color: "var(--text-primary)" }}>{activeFilePath ? basename(activeFilePath) : ""}</span>
        </div>
      )}

      {/* ── Compose palette ── */}
      <ViewTransition show={composeOpen}>
        <ComposePalette
          symbols={symbolIndexRef.current}
          onAddStub={handleAddStub}
          onClose={() => setComposeOpen(false)}
        />
      </ViewTransition>

      {/* ── Top toolbar (Filters + Analyze + Add) ── */}
      <TopToolbar
        filtersOpen={filtersOpen}
        modelsOpen={modelsOpen}
        onToggleModels={() => setModelsOpen((v) => !v)}
        analysisOpen={analysisOpen}
        codeOpen={codeOpen}
        codeEligible={codeEligible}
        viewMode={viewMode}
        threadEligible={threadEligible}
        editorOpen={editorOpen}
        refreshing={refreshChipVisible}
        draftOpen={draftOpen}
        drafting={drafting}
        onToggleDraft={() => setDraftOpen((v) => !v)}
        describeAvailable={isDirectoryMode}
        describeOpen={describeOpen}
        describing={describing}
        onToggleDescribe={() => setDescribeOpen((v) => !v)}
        buildAvailable={isDirectoryMode && systemPlan != null}
        buildOpen={buildOpen}
        building={building}
        onToggleBuild={() => setBuildOpen((v) => !v)}
        onToggleEditor={() => setEditorOpen((v) => !v)}
        onToggleFilters={() => { setFiltersOpen((v) => !v); setAnalysisOpen(false); }}
        onToggleAnalysis={() => { setAnalysisOpen((v) => !v); setFiltersOpen(false); }}
        onToggleCode={handleToggleCode}
        onToggleThread={handleToggleThread}
        onToggleSystem={handleToggleSystem}
        systemAvailable={isDirectoryMode}
        onToggleArchitecture={handleToggleArchitecture}
        architectureAvailable={architectureAvailable}
      />

      {/* PLAN-v7 Stage 1b — the minimal intent field. Describe the insertion;
          submit drafts it via `claude -p` and previews the result as a ghost
          before any write. Anchors on the selected node when there is one. */}
      {draftOpen && (
        <div
          data-draft-bar
          style={{
            position: "fixed", top: "calc(var(--vg-toolbar-bottom, 43px) + 16px)", right: 18, zIndex: 1010, width: 360,
            background: "color-mix(in oklab, var(--bg-node) 92%, transparent)",
            border: "1px solid color-mix(in oklab, var(--accent-chat) 40%, transparent)",
            borderRadius: 8, padding: 12, boxShadow: "var(--shadow-control)",
            backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            display: "flex", flexDirection: "column", gap: 8,
            // The dialog grows with its textarea, but never past the viewport:
            // an action row below the fold is unreachable, not merely ugly.
            maxHeight: "calc(100vh - var(--vg-toolbar-bottom, 43px) - 32px)",
            overflowY: "auto",
          }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-11)",
            fontFamily: "var(--font-mono)", color: "var(--accent-chat)", fontWeight: 700,
          }}>
            <Sparkles size={16} strokeWidth={1.5} />
            Draft insert with Claude
          </div>
          <div style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {chatContextNode
              ? `Insert after: ${(chatContextNode as any).name ?? (chatContextNode as any).funcName ?? chatContextNode.type}`
              : "Append to the active file (select a node to anchor)"}
          </div>
          {/* textarea, not input: a one-line input cannot wrap, so a long
              intent scrolled sideways out of view. Enter still submits;
              Shift+Enter now inserts a newline (matches Describe). */}
          <textarea
            data-draft-intent
            autoFocus
            ref={draftGrow}
            rows={1}
            value={draftIntent}
            onChange={(e) => setDraftIntent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleDraftSubmit(); }
              else if (e.key === "Escape") { setDraftOpen(false); setDraftIntent(""); }
            }}
            placeholder="e.g. add a retry wrapper around the request"
            style={{
              background: "var(--bg-canvas)", border: "1px solid var(--border-edge)",
              borderRadius: 6, padding: "6px 10px", color: "var(--text-primary)",
              fontSize: "var(--fs-12)", fontFamily: "var(--font-mono)", outline: "none",
              resize: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              data-draft-cancel
              onClick={() => { setDraftOpen(false); setDraftIntent(""); }}
              style={{
                background: "none", border: "1px solid var(--border-edge)", borderRadius: 5,
                color: "var(--text-muted)", fontSize: "var(--fs-11)", fontWeight: 700,
                padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font-mono)",
              }}
            >
              Cancel
            </button>
            <button
              data-draft-submit
              disabled={!draftIntent.trim()}
              onClick={handleDraftSubmit}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "color-mix(in oklab, var(--accent-chat) 16%, transparent)",
                border: "1px solid color-mix(in oklab, var(--accent-chat) 45%, transparent)",
                borderRadius: 5, color: "var(--accent-chat)", fontSize: "var(--fs-11)",
                fontWeight: 700, padding: "4px 12px",
                cursor: draftIntent.trim() ? "pointer" : "not-allowed",
                opacity: draftIntent.trim() ? 1 : 0.5, fontFamily: "var(--font-mono)",
              }}
            >
              <Sparkles size={14} strokeWidth={1.5} /> Draft
            </button>
          </div>
        </div>
      )}

      {/* PLAN-v7 Stage 1 (1b hardening) — the proposal decision gate. A FIXED
          top-centre bar (z above the docked chat panel's 900) so accept/reject
          is always reachable, even when the ghost node itself is occluded by a
          dock. The ghost is a pure preview; this bar owns the decision. Buttons
          dispatch the same vg-proposal-* events the ghost used to. */}
      {pendingProposal && (
        <div
          data-proposal-bar
          style={{
            // Below the toolbar row (top:10, ~40 tall) and above it in z so a
            // centred bar is never occluded by the wide right-aligned toolbar.
            position: "fixed", top: "calc(var(--vg-toolbar-bottom, 43px) + 12px)", left: "50%", transform: "translateX(-50%)",
            zIndex: 1015, display: "flex", alignItems: "center", gap: 12,
            background: "color-mix(in oklab, var(--bg-node) 92%, transparent)",
            border: "1px solid var(--proposed-border)", borderRadius: 8,
            padding: "6px 8px 6px 14px", boxShadow: "0 0 14px var(--proposed-glow)",
            backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", color: "var(--accent-chat)" }}>
            <Sparkles size={16} strokeWidth={1.5} />
          </span>
          <span style={{ fontSize: "var(--fs-12)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            <span style={{ color: "var(--text-muted)" }}>
              {pendingProposal.drafted ? "Claude drafted " : "Proposed "}
            </span>
            {pendingProposal.ghostNodes[0]?.label ?? "change"}
            <span style={{ color: "var(--text-muted)" }}> — not yet written</span>
          </span>
          <GateButton
            data-proposal-accept
            accent="thread" filled armOnClick resetKey={pendingProposal}
            pendingLabel="Writing…"
            onClick={() => document.dispatchEvent(new CustomEvent("vg-proposal-accept"))}
          >
            <Check size={14} strokeWidth={1.5} /> Accept
          </GateButton>
          <GateButton
            data-proposal-reject
            accent="neutral" resetKey={pendingProposal}
            onClick={() => document.dispatchEvent(new CustomEvent("vg-proposal-reject"))}
          >
            <X size={14} strokeWidth={1.5} /> Reject
          </GateButton>
        </div>
      )}

      {/* PLAN-v7 Stage 3b — the project-description field. Describe the
          system; submit drafts an architecture via `claude -p` and previews
          it as a ghost tier in the system view, gated behind ratification. */}
      {describeOpen && (
        <div
          data-describe-bar
          style={{
            position: "fixed", top: "calc(var(--vg-toolbar-bottom, 43px) + 16px)", right: 18, zIndex: 1010, width: 420,
            background: "color-mix(in oklab, var(--bg-node) 92%, transparent)",
            border: "1px solid color-mix(in oklab, var(--accent-chat) 40%, transparent)",
            borderRadius: 8, padding: 12, boxShadow: "var(--shadow-control)",
            backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            display: "flex", flexDirection: "column", gap: 8,
            // The dialog grows with its textarea, but never past the viewport:
            // an action row below the fold is unreachable, not merely ugly.
            maxHeight: "calc(100vh - var(--vg-toolbar-bottom, 43px) - 32px)",
            overflowY: "auto",
          }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-11)",
            fontFamily: "var(--font-mono)", color: "var(--accent-chat)", fontWeight: 700,
          }}>
            <Sparkles size={16} strokeWidth={1.5} />
            Describe the system — Claude proposes the architecture
          </div>
          <div style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            A plan, not code: you ratify the ghost architecture before anything is built.
          </div>
          <textarea
            data-describe-text
            autoFocus
            ref={describeGrow}
            rows={3}
            value={describeText}
            onChange={(e) => setDescribeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleDescribeSubmit(); }
              else if (e.key === "Escape") { setDescribeOpen(false); setDescribeText(""); }
            }}
            placeholder="e.g. a flask API over a sqlite store, with a redis cache in front of the hot queries"
            style={{
              background: "var(--bg-canvas)", border: "1px solid var(--border-edge)",
              borderRadius: 6, padding: "6px 10px", color: "var(--text-primary)",
              fontSize: "var(--fs-12)", fontFamily: "var(--font-mono)", outline: "none",
              // Height is driven by useAutoGrow; manual resize would fight it.
              resize: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              data-describe-cancel
              className="vg-gate-btn"
              onClick={() => { setDescribeOpen(false); setDescribeText(""); }}
              style={{
                background: "none", border: "1px solid var(--border-edge)", borderRadius: 5,
                color: "var(--text-muted)", fontSize: "var(--fs-11)", fontWeight: 700,
                padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font-mono)",
              }}
            >
              Cancel
            </button>
            <button
              data-describe-submit
              className="vg-gate-btn"
              disabled={!describeText.trim()}
              onClick={handleDescribeSubmit}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "color-mix(in oklab, var(--accent-chat) 16%, transparent)",
                border: "1px solid color-mix(in oklab, var(--accent-chat) 45%, transparent)",
                borderRadius: 5, color: "var(--accent-chat)", fontSize: "var(--fs-11)",
                fontWeight: 700, padding: "4px 12px",
                cursor: describeText.trim() ? "pointer" : "not-allowed",
                opacity: describeText.trim() ? 1 : 0.5, fontFamily: "var(--font-mono)",
              }}
            >
              <Sparkles size={14} strokeWidth={1.5} /> Propose architecture
            </button>
          </div>
        </div>
      )}

      {/* PLAN-v7 Stage 4b — the capability field. Describe ONE capability;
          the builder drafts the increment toward the ratified plan, the
          verification floor runs, and the changeset gate owns acceptance. */}
      {buildOpen && (
        <div
          data-build-bar
          style={{
            position: "fixed", top: "calc(var(--vg-toolbar-bottom, 43px) + 16px)", right: 18, zIndex: 1010, width: 420,
            background: "color-mix(in oklab, var(--bg-node) 92%, transparent)",
            border: "1px solid color-mix(in oklab, var(--accent-chat) 40%, transparent)",
            borderRadius: 8, padding: 12, boxShadow: "var(--shadow-control)",
            backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            display: "flex", flexDirection: "column", gap: 8,
            // The dialog grows with its textarea, but never past the viewport:
            // an action row below the fold is unreachable, not merely ugly.
            maxHeight: "calc(100vh - var(--vg-toolbar-bottom, 43px) - 32px)",
            overflowY: "auto",
          }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-11)",
            fontFamily: "var(--font-mono)", color: "var(--accent-chat)", fontWeight: 700,
          }}>
            <Sparkles size={16} strokeWidth={1.5} />
            Build a capability — toward the approved plan
          </div>
          <div style={{ fontSize: "var(--fs-11)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            The builder drafts one increment; you review files + a passing check before anything is written.
          </div>
          {/* textarea for the same reason as Draft — see the note there. */}
          <textarea
            data-build-intent
            autoFocus
            ref={buildGrow}
            rows={1}
            value={buildText}
            onChange={(e) => setBuildText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleBuildSubmit(); }
              else if (e.key === "Escape") { setBuildOpen(false); setBuildText(""); }
            }}
            placeholder="e.g. the create-note flow: a POST route that stores a note"
            style={{
              background: "var(--bg-canvas)", border: "1px solid var(--border-edge)",
              borderRadius: 6, padding: "6px 10px", color: "var(--text-primary)",
              fontSize: "var(--fs-12)", fontFamily: "var(--font-mono)", outline: "none",
              resize: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              data-build-cancel
              className="vg-gate-btn"
              onClick={() => { setBuildOpen(false); setBuildText(""); }}
              style={{
                background: "none", border: "1px solid var(--border-edge)", borderRadius: 5,
                color: "var(--text-muted)", fontSize: "var(--fs-11)", fontWeight: 700,
                padding: "4px 10px", cursor: "pointer", fontFamily: "var(--font-mono)",
              }}
            >
              Cancel
            </button>
            <button
              data-build-submit
              className="vg-gate-btn"
              disabled={!buildText.trim()}
              onClick={handleBuildSubmit}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "color-mix(in oklab, var(--accent-chat) 16%, transparent)",
                border: "1px solid color-mix(in oklab, var(--accent-chat) 45%, transparent)",
                borderRadius: 5, color: "var(--accent-chat)", fontSize: "var(--fs-11)",
                fontWeight: 700, padding: "4px 12px",
                cursor: buildText.trim() ? "pointer" : "not-allowed",
                opacity: buildText.trim() ? 1 : 0.5, fontFamily: "var(--font-mono)",
              }}
            >
              <Sparkles size={14} strokeWidth={1.5} /> Draft increment
            </button>
          </div>
        </div>
      )}

      {/* PLAN-v7 Stage 3 — the architecture ratification gate. Same fixed
          always-reachable pattern as the compose proposal bar above (2nd
          inline use — extract on the 3rd). Accept RATIFIES (persists the plan
          artifact; ghosts stay PLANNED until built); reject drops the overlay,
          nothing persisted. Honest about inference: the bar counts how much of
          the plan is NOT traceable to the user's words. Stacks below the
          compose bar in the (unlikely) case both gates are open. */}
      {pendingSystemPlan && (() => {
        const inferredCount =
          pendingSystemPlan.subsystems.filter((s) => s.groundedIn == null).length +
          pendingSystemPlan.edges.filter((e) => e.groundedIn == null).length;
        return (
          <div
            data-system-plan-bar
            style={{
              position: "fixed", top: pendingProposal ? "calc(var(--vg-toolbar-bottom, 43px) + 64px)" : "calc(var(--vg-toolbar-bottom, 43px) + 12px)", left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1015, display: "flex", alignItems: "center", gap: 12,
              background: "color-mix(in oklab, var(--bg-node) 92%, transparent)",
              border: "1px solid var(--proposed-border)", borderRadius: 8,
              padding: "6px 8px 6px 14px", boxShadow: "0 0 14px var(--proposed-glow)",
              backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", color: "var(--accent-chat)" }}>
              <Sparkles size={16} strokeWidth={1.5} />
            </span>
            <span style={{ fontSize: "var(--fs-12)", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              <span style={{ color: "var(--text-muted)" }}>
                {pendingSystemPlan.drafted ? "Claude proposed architecture " : "Proposed architecture "}
              </span>
              {pendingSystemPlan.subsystems.length} subsystems
              {inferredCount > 0 && (
                <span style={{ color: "var(--accent-warning)" }}> · {inferredCount} inferred</span>
              )}
              <span style={{ color: "var(--text-muted)" }}> — a plan, not yet built</span>
            </span>
            {/* Sitting-2 — the primary chains straight into the roadmap
                draft (the bottom-left panel appears already DRAFTING, so
                motion carries the eye instead of a hunt for its button).
                data-system-plan-accept keeps its approve-only semantics —
                existing specs and the "decide later" path use it. */}
            <GateButton
              data-system-plan-accept-draft
              accent="thread" filled armOnClick resetKey={pendingSystemPlan}
              pendingLabel="Approving…"
              title="Ratify the architecture and start drafting the roadmap (the roadmap gets its own approval)"
              onClick={() => {
                draftAfterApprove.current = true;
                document.dispatchEvent(new CustomEvent("vg-system-plan-accept"));
              }}
            >
              <Check size={14} strokeWidth={1.5} /> Approve & draft roadmap
            </GateButton>
            <GateButton
              data-system-plan-accept
              accent="thread" armOnClick resetKey={pendingSystemPlan}
              pendingLabel="Approving…"
              title="Ratify the architecture only — draft the roadmap later from its panel"
              onClick={() => document.dispatchEvent(new CustomEvent("vg-system-plan-accept"))}
            >
              Approve only
            </GateButton>
            <GateButton
              data-system-plan-reject
              accent="neutral" resetKey={pendingSystemPlan}
              onClick={() => document.dispatchEvent(new CustomEvent("vg-system-plan-reject"))}
            >
              <X size={14} strokeWidth={1.5} /> Reject
            </GateButton>
          </div>
        );
      })()}

      {/* PLAN-v7 Stage 4 — the build-increment gate: files + contents + the
          verification floor, accept enabled only when the floor is green. */}
      {pendingChangeset && <ChangesetGate pending={pendingChangeset} />}

      {/* PLAN-v7 Stage 5 — the roadmap: proposed (ratify gate), ratified
          (live statuses + run dial + failure triage), or the draft CTA when
          only the architecture is ratified so far. */}
      {isDirectoryMode && systemPlan != null && (
        <RoadmapPanel
          plan={buildPlan}
          pending={pendingBuildPlan}
          run={buildRunState}
          drafting={roadmapDrafting}
          // Sitting-2 — lift clear of the full-width bottom chat bar (same
          // shift the chat toggle makes); the docked-chat case keeps the
          // right column, no overlap.
          lift={fullWidthChat}
          onDraft={handleDraftRoadmap}
        />
      )}

      {/* Sitting-2 — the pin-outcome notice (transient, bottom-center,
          above the bottom panels; auto-dismisses). */}
      {seedNotice && (
        <div
          data-seed-notice
          data-seed-outcome={seedNotice.outcome}
          style={{
            position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
            zIndex: 1020, display: "flex", alignItems: "center", gap: 8,
            background: "color-mix(in oklab, var(--bg-node) 94%, transparent)",
            border: "1px solid var(--border-edge)", borderRadius: 8,
            padding: "8px 12px", boxShadow: "var(--shadow-control)",
            backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)",
          }}
        >
          <span style={{
            color: seedNotice.outcome === "not-seeded" ? "var(--accent-warning)" : "var(--text-primary)",
          }}>
            {seedNotice.outcome === "added" && (
              <>Thread started — <span style={{ color: "var(--accent-thread)" }}>{seedNotice.qualifiedName}</span> is a manual row in the launchpad.</>
            )}
            {seedNotice.outcome === "already-seeded" && (
              <>Already has a thread — <span style={{ color: "var(--accent-thread)" }}>{seedNotice.qualifiedName}</span> is seeded as {seedNotice.kind}. Pinning is for functions nothing calls yet.</>
            )}
            {seedNotice.outcome === "not-seeded" && (
              <>Pin didn't take — discovery dropped the seed (not a resolvable function definition).</>
            )}
          </span>
          {seedNotice.entryPointId && (
            <button
              data-seed-notice-open
              className="vg-gate-btn"
              onClick={() => {
                const id = seedNotice.entryPointId;
                setSeedNotice(null);
                document.dispatchEvent(new CustomEvent("vg-open-thread", { detail: { entryPointId: id } }));
              }}
              style={{
                background: "color-mix(in oklab, var(--accent-thread) 14%, transparent)",
                border: "1px solid color-mix(in oklab, var(--accent-thread) 40%, transparent)",
                borderRadius: 4, color: "var(--accent-thread)", padding: "2px 8px",
                cursor: "pointer", fontSize: "var(--fs-11)", fontFamily: "var(--font-mono)", fontWeight: 600,
              }}
            >Open thread</button>
          )}
          <button
            onClick={() => setSeedNotice(null)}
            title="Dismiss"
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", padding: 2, display: "flex", alignItems: "center",
            }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <KeyBanner
        show={anthropicAvailable === false && !keyBannerDismissed}
        onDismiss={() => setKeyBannerDismissed(true)}
      />
      <DepsBanner
        missing={missingDeps}
        dismissed={depsBannerDismissed}
        onDismiss={() => setDepsBannerDismissed(true)}
        // Below the toolbar band; stacks under the key banner when both show.
        top={anthropicAvailable === false && !keyBannerDismissed ? 96 : 56}
      />

      {/* ── Model tiers ── */}
      {modelsOpen && (
        <ModelTiersPanel
          tiers={modelTiers}
          onChange={setModelTiers}
          onClose={() => setModelsOpen(false)}
        />
      )}

      {/* ── Filters panel ── */}
      <ViewTransition show={filtersOpen}>
        <FiltersPanel
          filters={nodeFilters}
          onChange={setNodeFilters}
          onClose={() => setFiltersOpen(false)}
          // Only meaningful in the file/diagram view — the edge toggles do
          // not apply to thread / system / arch, so no counts are claimed there.
          flowStats={viewMode === "diagram" && zoomLevel === "file" ? flowStats : undefined}
        />
      </ViewTransition>

      {/* ── Analysis card ── */}
      <ViewTransition show={analysisOpen}>
        <AnalysisCard
          activeFilePath={activeFilePath}
          onClose={() => setAnalysisOpen(false)}
        />
      </ViewTransition>

      {hiddenNodeIds.size > 0 && (
        <button onClick={() => setHiddenNodeIds(new Set())} title="Restore hidden nodes"
          style={{
            // W3 — sit ABOVE the react-flow map (and any panel) and clear of
            // the bottom-right minimap, so the reveal control is never
            // obscured by edges/nodes/minimap. z above MonacoOverlay (1000).
            position: "fixed", bottom: fullWidthChat ? "calc(var(--vg-chat-height, 320px) + 60px)" : 188, right: 20, zIndex: 1001,
            background: "color-mix(in oklab, var(--accent-warning) 12%, transparent)",
            border: "1px solid color-mix(in oklab, var(--accent-warning) 40%, transparent)",
            borderRadius: 16, color: "var(--accent-warning)", fontSize: "var(--fs-11)",
            fontFamily: "var(--font-mono)", fontWeight: 700, padding: "5px 12px",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            boxShadow: "var(--shadow-control)", transition: "bottom 0.18s ease",
          }}>
          <Eye size={16} strokeWidth={1.5} /> Show hidden ({hiddenNodeIds.size})
        </button>
      )}

      {composeError && (
        <div style={{
          position: "fixed", bottom: fullWidthChat ? "calc(var(--vg-chat-height, 320px) + 12px)" : 12, left: composeOpen ? 248 : 18, zIndex: 960,
          background: "color-mix(in oklab, var(--accent-error) 12%, transparent)",
          border: "1px solid color-mix(in oklab, var(--accent-error) 40%, transparent)",
          borderRadius: 6, padding: "6px 12px", fontSize: "var(--fs-11)",
          fontFamily: "var(--font-mono)", color: "var(--accent-error)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <AlertCircle size={16} strokeWidth={1.5} /> {composeError}
          <button onClick={() => setComposeError(null)}
            style={{ background: "none", border: "none", color: "var(--accent-error)", cursor: "pointer", fontSize: "var(--fs-12)", padding: 0, display: "flex", alignItems: "center" }}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* M28.3 — the floating chat toggle is only for the no-code-panel
          case; once a code panel is open the chat is permanently docked
          beneath it, so the toggle would be redundant (and would land
          right where the docked chat sits). */}
      {!regionOpen && (
        <FloatingToggles
          chatOpen={chatOpen}
          // Manual toggle: the chat is now the user's, not region-driven, so
          // a later code-panel close won't retract it.
          onToggleChat={() => { chatFromRegion.current = false; setChatOpen((o) => !o); }}
          chatContextLabel={chatContextLabel}
          rightInset={20}
        />
      )}

      {/* MonacoOverlay is NOT wrapped in ViewTransition: ViewTransition's
          wrapper div carries a `transform` animation, which establishes
          a new containing block per the CSS spec -- that breaks the
          overlay's `position: fixed` and renders it off-screen at
          height=5. The overlay has its own slide-in shadow design, so
          the 280ms view-transition cue isn't load-bearing here. */}
      {editState && (
        <MonacoOverlay
          nodeId={editState.nodeId}
          nodeType={editState.nodeType}
          nodeLabel={editState.nodeLabel}
          filePath={activeFilePath}
          onClose={() => setEditState(null)}
        />
      )}

      {codeOpen && (
        <CodeView
          filePath={activeFilePath}
          source={fileSource}
          error={fileSourceError}
          // Spans MUST track the same parse as `source`. astNodesRef is
          // only refreshed in the file-zoom branch of the envelope
          // handler, so after a live edit made from the thread/project
          // view (zoomLevel "project") it goes stale — CodeView would
          // reveal the old [line,endLine] against the new text and land on
          // the wrong region. Read the active file's CURRENT nodes from
          // the envelope (projectData) at render; App re-renders on each
          // envelope (setProjectThreads), so this stays live. Falls back
          // to astNodesRef for single-file mode (no projectData).
          astNodes={(activeFilePath && projectDataRef.current[activeFilePath]?.nodes) || astNodesRef.current}
          selectedNodeId={chatContextNode?.id ?? null}
          onClose={() => setCodeOpen(false)}
          dock={codeDock}
        />
      )}

      {/* U1.2: NOT wrapped in ViewTransition. Same rationale as
          MonacoOverlay above — the wrapper's transform breaks
          position: fixed AND establishes a new stacking context, which
          caused ChatPanel to render in the wrong place and lose its
          zIndex battle against the side panel. Trade-off: lose the
          280ms enter/exit motion (accepted). */}
      {(regionOpen || chatOpen) && (
        <ChatPanel
          contextNode={chatContextNode}
          activeFilePath={activeFilePath}
          threadEntryPointId={viewMode === "thread" && !chatThreadDetached ? activeEntryPointId : null}
          threadLabel={viewMode === "thread" && activeEntryPointId
            ? (entryPoints.find((e) => e.id === activeEntryPointId)?.qualifiedName ?? activeEntryPointId)
            : null}
          threadDetached={chatThreadDetached}
          onToggleThreadAttach={() => setChatThreadDetached((v) => !v)}
          isDirectoryMode={isDirectoryMode}
          focusTrigger={chatFocusTrigger}
          prefill={chatPrefill}
          // M28.3 — docked beneath the code column when one is open
          // (always present, no close button); else the full-width bar,
          // closed via the floating sparkle toggle (its open-state X).
          dock={chatDock}
          onClearContext={() => setChatContextNode(null)}
        />
      )}

      {expandedAstNode && (
        <NodeExpandedOverlay
          node={expandedAstNode}
          onClose={() => setExpandedNodeId(null)}
        />
      )}

      {/* M18.1 — node editor panel. Kept mounted while open so its
          dirty-guard state survives selection changes; the panel
          resolves the enclosing function from the selection itself. */}
      <NodeEditorPanel
        open={editorOpen}
        node={chatContextNode}
        filePath={activeFilePath}
        projectData={projectDataRef.current}
        astNodes={astNodesRef.current}
        onClose={() => setEditorOpen(false)}
        dock={editorDock}
      />
    </>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <div style={{ width: "100%", height: "100vh" }}>
        <Graph />
      </div>
    </ReactFlowProvider>
  );
}
