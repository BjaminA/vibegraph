import React, { useState } from "react";
import { Cpu, Spline, GitBranch, FileText, Pencil, Network, Boxes, Layers, Sparkles, DraftingCompass, Hammer, Bot, Compass } from "lucide-react";

interface Props {
  filtersOpen: boolean;
  modelsOpen: boolean;
  analysisOpen: boolean;
  codeOpen: boolean;
  codeEligible: boolean;
  viewMode: "index" | "diagram" | "thread" | "system" | "architecture";
  threadEligible: boolean;
  // M18.1 — node editor panel toggle. Always available; opening with no
  // selection shows the panel's empty state.
  editorOpen: boolean;
  // M19.2 — system view toggle. Only meaningful in directory mode (the
  // system tier ships empty in single-file mode).
  systemAvailable: boolean;
  // Architecture lens (5th view) — offered only when a PyTorch nn.Module
  // model is present in the project.
  architectureAvailable: boolean;
  // M26.4 — derived refresh (re-link / re-extract) in flight on the
  // server; shows the muted pulse-dot chip. State-driven between the
  // graph-refresh started/done WS events — never an open-ended spinner.
  refreshing: boolean;
  /** Status chips (missing Claude CLI, missing project imports) — rendered
   *  in the toolbar so they never float over a view's own controls. */
  notices?: React.ReactNode;
  // PLAN-v7 Stage 1b — the "Draft insert with Claude" affordance. draftOpen
  // toggles the minimal intent field; drafting disables it while `claude -p`
  // is producing the proposal.
  draftOpen: boolean;
  drafting: boolean;
  onToggleDraft: () => void;
  // PLAN-v7 Stage 3b — the "Describe" affordance: a project description →
  // claude -p architecture draft → ghost system view. Directory mode only
  // (the system tier ships empty in single-file mode).
  describeAvailable: boolean;
  describeOpen: boolean;
  describing: boolean;
  onToggleDescribe: () => void;
  // PLAN-v7 Stage 4b — the "Build" affordance: one capability → the builder
  // drafts an increment toward the RATIFIED plan → the changeset gate.
  // Offered only when a ratified plan exists (the builder's input contract).
  buildAvailable: boolean;
  buildOpen: boolean;
  building: boolean;
  onToggleBuild: () => void;
  onToggleFilters: () => void;
  onToggleModels: () => void;
  // M-STACK.3 — the Stack panel: what the project is built on (IR fact)
  // and the policies stated about each tool. Directory mode only — a
  // single file has no project to index.
  stackOpen: boolean;
  stackAvailable: boolean;
  onToggleStack: () => void;
  // M-SKILLS.2 — the Skills panel: generic direction, enabled per project.
  // Directory mode only (the enable file lives under the project).
  skillsOpen: boolean;
  skillsAvailable: boolean;
  onToggleSkills: () => void;
  // M-AGENT2 — the Agent Manager run board. Directory mode only.
  workRunOpen: boolean;
  workRunAvailable: boolean;
  onToggleWorkRun: () => void;
  onToggleAnalysis: () => void;
  onToggleCode: () => void;
  onToggleThread: () => void;
  onToggleSystem: () => void;
  onToggleArchitecture: () => void;
  onToggleEditor: () => void;
}

// The bar reads as three clusters, not nine peer buttons: views (where
// am I looking), canvas tools (what am I doing to it), Claude actions
// (delegated work — accent-chat). Each group is a single flex item so
// the container's wrap breaks BETWEEN groups, never inside one, and the
// divider is a quiet 1px rule in --border-edge (no separator component
// exists elsewhere; this is deliberately the smallest possible one).
function ToolGroup({
  name,
  divider,
  children,
}: {
  name: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-toolbar-group={name}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        ...(divider
          ? { borderLeft: "1px solid var(--border-edge)", paddingLeft: 8 }
          : {}),
      }}
    >
      {children}
    </div>
  );
}

function ToolButton({
  active,
  disabled,
  onClick,
  title,
  accent,
  children,
  ...rest
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  accent: string;
  // data-* passthrough for e2e hooks (M-AGENT2 added the first).
  [key: `data-${string}`]: boolean | string | undefined;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      {...rest}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => !disabled && onClick()}
      title={title}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        background: active
          ? `color-mix(in oklab, ${accent} 20%, transparent)`
          : (hover ? `color-mix(in oklab, ${accent} 12%, transparent)` : "transparent"),
        border: `1px solid ${active
          ? `color-mix(in oklab, ${accent} 60%, transparent)`
          : (hover ? `color-mix(in oklab, ${accent} 33%, transparent)` : `color-mix(in oklab, ${accent} 20%, transparent)`)}`,
        borderRadius: 6,
        color: active ? "var(--text-primary)" : accent,
        // Inter at 12, medium: the toolbar is navigation, not code
        // (2026-09-24 look pass; it was 11px bold monospace).
        fontSize: "var(--fs-12)",
        fontFamily: "var(--font-ui)",
        fontWeight: 500,
        letterSpacing: "0.01em",
        padding: "4px 12px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all 0.12s",
      }}
    >
      {children}
    </button>
  );
}

/** Taller than this and the toolbar has wrapped to a second row. */
const ONE_ROW_MAX = 52;

/**
 * Top offset for any fixed surface that must sit BELOW the toolbar band.
 *
 * The band WRAPS, so its height is not a constant: measured 2026-09-21 on a
 * 900px-tall window, its bottom edge is 48px at 1800px wide, 82px at 1280
 * and 116px at 1100. Every surface that hardcoded the one-row figure slid
 * underneath it — the Stack and Models panels pinned themselves at 56px and
 * lost their own headers behind the wrapped second row. W9 converted the
 * two right docks to the variable and left these; this is the helper, so
 * the next surface cannot get it wrong.
 *
 * `gap` is the space between band and surface: 16 for a right-edge panel,
 * 12 for a centred banner — the conventions already in App.tsx.
 */
export function belowToolbar(gap = 8): string {
  return `calc(var(--vg-toolbar-bottom, 43px) + ${gap}px)`;
}

/** Height available to a surface starting at `belowToolbar(gap)` that must
 *  not run off the bottom. Replaces a fixed `80vh`, which assumed the same
 *  one-row band. */
export function heightBelowToolbar(gap = 8, bottomMargin = 24): string {
  return `calc(100vh - var(--vg-toolbar-bottom, 43px) - ${gap + bottomMargin}px)`;
}

export function TopToolbar({
  filtersOpen, modelsOpen, analysisOpen, codeOpen, codeEligible,
  viewMode, threadEligible,
  editorOpen, systemAvailable, architectureAvailable, refreshing, notices,
  draftOpen, drafting, onToggleDraft,
  describeAvailable, describeOpen, describing, onToggleDescribe,
  buildAvailable, buildOpen, building, onToggleBuild,
  onToggleFilters, onToggleModels, stackOpen, stackAvailable, onToggleStack,
  skillsOpen, skillsAvailable, onToggleSkills,
  workRunOpen, workRunAvailable, onToggleWorkRun,
  onToggleAnalysis, onToggleCode, onToggleThread,
  onToggleSystem, onToggleArchitecture, onToggleEditor,
}: Props) {
  const threadActive = viewMode === "thread";
  const systemActive = viewMode === "system";
  const architectureActive = viewMode === "architecture";

  // UI cleanup (post-M-RUN3) — the toolbar WRAPS at narrow widths (the
  // overflow fix below), so its height is not a constant. Publish the real
  // bottom edge as --vg-toolbar-bottom; every fixed element that sits "under
  // the toolbar" (badges, side panels, gates) binds to the variable instead
  // of hardcoding the one-row 43px — the skills/README badges were being
  // swallowed by the wrapped second row.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--vg-toolbar-bottom", `${Math.round(el.getBoundingClientRect().bottom)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", publish);
      document.documentElement.style.removeProperty("--vg-toolbar-bottom");
    };
  }, []);

  // Overlap pass — a wrapped toolbar is a second row of glass over every
  // view's own top controls (the System view's mode bar, its top cards, the
  // thread's first row). When the labelled buttons would wrap, the tools and
  // Claude groups drop to icons (their names stay in title + accessible
  // name); only a window too narrow even for that still wraps. Measured
  // before paint, and re-tried in full on every resize.
  const [compact, setCompact] = useState(false);
  const [probe, setProbe] = useState(0);
  React.useEffect(() => {
    const retry = () => { setCompact(false); setProbe((n) => n + 1); };
    window.addEventListener("resize", retry);
    return () => window.removeEventListener("resize", retry);
  }, []);
  React.useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || compact) return;
    if (el.getBoundingClientRect().height > ONE_ROW_MAX) setCompact(true);
  });
  void probe;

  return (
    <div
      ref={rootRef}
      data-top-toolbar
      data-compact={compact ? "true" : undefined}
      style={{
        position: "fixed",
        top: 10,
        right: 18,
        display: "flex",
        // The toolbar gained a button per PLAN-v7 stage (Draft / Describe /
        // Build) and, unconstrained, slid left UNDER the side panel's
        // Threads|Files tab strip (ends ~268px) at narrow windows — the
        // Files tab became unclickable, and later the breadcrumb (starts
        // 298px, ends ~500px with a filename) was papered over the same way.
        // Cap the width short of BOTH and wrap into right-aligned rows.
        flexWrap: "wrap",
        justifyContent: "flex-end",
        maxWidth: "calc(100vw - 500px)",
        gap: 6,
        background: "color-mix(in oklab, var(--bg-node) 85%, transparent)",
        border: "1px solid var(--border-edge)",
        borderRadius: 12,
        padding: 4,
        // M6 wave 1 — bumped above CodeView (990) and MonacoOverlay
        // (1000) so the toolbar stays reachable while side panels are
        // open. Toolbar is global navigation; panels are content.
        zIndex: 1010,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        boxShadow: "var(--shadow-control)",
      }}
    >
      {/* M26.4 — re-link pulse. Muted housekeeping signal, not an alert:
          the server is re-deriving threads/entry points after an edit.
          Mounted only between graph-refresh started/done, so the pulse
          loop is bounded by real pipeline activity. */}
      {notices}
      {refreshing && (
        <div
          data-graph-refreshing
          title="Re-deriving threads after an edit"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            color: "var(--text-muted)",
            fontSize: 11,
            fontFamily: "monospace",
          }}
        >
          <span className="vg-relink-dot" />
          re-linking…
        </div>
      )}
      {/* Group 1 — views: where am I looking. */}
      <ToolGroup name="views">
      <ToolButton
        active={codeOpen}
        disabled={!codeOpen && !codeEligible}
        onClick={onToggleCode}
        title={
          codeOpen
            ? "Close code view"
            : codeEligible
              ? "Show source for the active file"
              : "Open a Python file first"
        }
        accent="var(--accent-thread)"
      >
        <FileText size={16} strokeWidth={1.5} />
        Code
      </ToolButton>
      <ToolButton
        active={threadActive}
        disabled={!threadActive && !threadEligible}
        onClick={onToggleThread}
        title={
          threadActive
            ? "Back to diagram view"
            : threadEligible
              ? "Trace this function as a thread"
              : "Select a function node first"
        }
        accent="var(--accent-thread)"
      >
        <GitBranch size={16} strokeWidth={1.5} />
        Thread
      </ToolButton>
      <ToolButton
        active={systemActive}
        disabled={!systemActive && !systemAvailable}
        onClick={onToggleSystem}
        title={
          systemActive
            ? "Back to diagram view"
            : systemAvailable
              ? "See how the subsystems connect (backend / frontend / db / cache)"
              : "Open a project (directory) first"
        }
        accent="var(--accent-thread)"
      >
        <Network size={16} strokeWidth={1.5} />
        System
      </ToolButton>
      <ToolButton
        active={architectureActive}
        disabled={!architectureActive && !architectureAvailable}
        onClick={onToggleArchitecture}
        title={
          architectureActive
            ? "Back to diagram view"
            : architectureAvailable
              ? "See the PyTorch model architecture (layers + forward path)"
              : "No PyTorch nn.Module model detected"
        }
        accent="var(--accent-thread)"
      >
        <Boxes size={16} strokeWidth={1.5} />
        Arch
      </ToolButton>
      </ToolGroup>

      {/* Group 2 — canvas tools: what am I doing to the view. */}
      <ToolGroup name="tools" divider>
      {/* Was "Filters" until 2026-08-03. It read as doing nothing, but the
          panel is the ONLY way to reveal file-view flow/structure edges
          (both default OFF — see DEFAULT_FILTERS), so removing it would
          have retired the M-FV.3 edge feature outright. Renamed to what
          people actually reach for it for; the node-kind toggles are the
          part that looks inert (they no-op in thread/system/arch). */}
      <ToolButton
        active={filtersOpen}
        onClick={onToggleFilters}
        title="Show / hide edges and node categories"
        accent="var(--accent-thread)"
      >
        <Spline size={16} strokeWidth={1.5} />
        Edges
      </ToolButton>
      <ToolButton
        active={editorOpen}
        onClick={onToggleEditor}
        title={editorOpen ? "Close editor" : "Open the node editor (click a node to load its function)"}
        accent="var(--accent-thread)"
      >
        <Pencil size={16} strokeWidth={1.5} />
        Edit
      </ToolButton>
      {/* Which model runs which kind of work. Chat is NOT here — it has a
          per-conversation picker, because a mid-conversation switch drops
          the model-scoped prompt cache. */}
      <ToolButton
        data-models-toggle
        active={modelsOpen}
        onClick={onToggleModels}
        title="Which model runs which kind of work"
        accent="var(--accent-chat)"
      >
        <Cpu size={16} strokeWidth={1.5} />
        Models
      </ToolButton>
      {/* M-STACK.3 — the software the project is built on, with the
          evidence behind each tool and the policies stated about it.
          Thread accent: these are facts about the user's own program. */}
      {stackAvailable && (
        <ToolButton
          data-stack-toggle
          active={stackOpen}
          onClick={onToggleStack}
          title="What this project is built on — tools by role, with their evidence and the policies stated about them"
          accent="var(--accent-thread)"
        >
          <Layers size={16} strokeWidth={1.5} />
          Stack
        </ToolButton>
      )}
      {/* M-SKILLS.2 — generic direction: the prose half of each quality
          dimension, enabled per project. Chat accent: it shapes what the
          agents are told, not what the code is. */}
      {skillsAvailable && (
        <ToolButton
          data-skills-toggle
          active={skillsOpen}
          onClick={onToggleSkills}
          title="Generic direction skills — enable per project; advisory, injected after the thread skill"
          accent="var(--accent-chat)"
        >
          <Compass size={16} strokeWidth={1.5} />
          Skills
        </ToolButton>
      )}
      </ToolGroup>

      {/* Group 3 — Claude actions: delegated work, all accent-chat. */}
      <ToolGroup name="claude" divider>
      {/* M-AGENT2 — the Agent Manager: task → thread packets → gated
          worker sessions. Thread accent (the run works the user's own
          program); the two human gates live inside the board. */}
      {workRunAvailable && (
        <ToolButton
          active={workRunOpen}
          onClick={onToggleWorkRun}
          title="Agent Manager — plan a task onto threads, ratify, review each packet"
          accent="var(--accent-thread)"
          data-work-run-toggle
        >
          <Bot size={16} strokeWidth={1.5} />
          Agents
        </ToolButton>
      )}
      {/* Analyze unmounted with Filters — see the note above. It DID
          work (handleAnalyzeFile spawns claude for a prose summary of the
          open file), but the chat answers the same question better and
          with follow-ups, so the button was redundant surface. */}
      {/* PLAN-v7 Stage 1b — describe an insertion in plain language; Claude
          drafts the function, the loop previews it as a ghost before any
          write. Chat accent because the source is Claude's, gated by accept. */}
      <ToolButton
        active={draftOpen}
        disabled={drafting}
        onClick={onToggleDraft}
        title={drafting ? "Claude is drafting…" : "Describe an insertion — Claude drafts it, you preview before writing"}
        accent="var(--accent-chat)"
      >
        <Sparkles size={16} strokeWidth={1.5} />
        {drafting ? "Drafting…" : "Draft"}
      </ToolButton>
      {/* PLAN-v7 Stage 3b — describe a project in plain language; Claude
          proposes the architecture, ghost-rendered in the system view and
          gated behind human ratification. Chat accent: the plan is Claude's. */}
      {describeAvailable && (
        <ToolButton
          active={describeOpen}
          disabled={describing}
          onClick={onToggleDescribe}
          title={describing
            ? "Claude is proposing an architecture…"
            : "Describe the system — Claude proposes an architecture, you ratify before anything is built"}
          accent="var(--accent-chat)"
        >
          <DraftingCompass size={16} strokeWidth={1.5} />
          {describing ? "Proposing…" : "Describe"}
        </ToolButton>
      )}
      {/* PLAN-v7 Stage 4b — build one capability toward the ratified plan;
          the builder drafts the increment, the verification floor runs, and
          the changeset gate owns acceptance. Offered only once a plan is
          ratified — the builder never works without a human-approved target. */}
      {buildAvailable && (
        <ToolButton
          active={buildOpen}
          disabled={building}
          onClick={onToggleBuild}
          title={building
            ? "The builder is drafting an increment…"
            : "Build one capability toward the approved plan — reviewed at the changeset gate before anything is written"}
          accent="var(--accent-chat)"
        >
          <Hammer size={16} strokeWidth={1.5} />
          {building ? "Building…" : "Build"}
        </ToolButton>
      )}
      </ToolGroup>
    </div>
  );
}
