// M-ARCH.2 — the architecture map's chrome: the LENS switch, the LEGEND
// (only the categories present), the INSPECTOR (the selected box or edge:
// what it is, the fact its protocol was read from, the threads it opens,
// the call sites it came from) and the UNPLACED line (what the picture
// leaves out, counted). Everything shown is on the model; nothing here
// derives.

import React from "react";
import { X, Sparkles, Check, Pencil, ChevronUp, ChevronDown } from "lucide-react";
import type { ArchModelRecord, ArchNodeRecord, ArchEdgeRecord, ArchGroupRecord } from "../../shared/protocol";
import { ARCH_CATEGORIES, ARCH_CATEGORY_LABEL } from "../../shared/arch_protocol";
import { archVisual } from "./arch_visual";
import { ARCH_LENSES, edgeLabel, type ArchLens } from "./archLayout";
import { ArchDispatchList } from "./ArchDispatchList";

const LENS_LABEL: Record<ArchLens, string> = { birdseye: "Bird's-eye", overview: "Overview", tools: "Tools", flows: "Flows", payloads: "Payloads", trust: "Trust" };

const SOURCE_TONE: Record<string, string> = {
  derived: "var(--text-muted)", stated: "var(--accent-config)", observed: "var(--accent-thread)",
};

const panel: React.CSSProperties = {
  background: "color-mix(in oklab, var(--bg-node) 92%, transparent)",
  border: "1px solid var(--border-edge)",
  borderRadius: 8,
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-11)",
  color: "var(--text-secondary)",
};
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)" };
const traceBtn: React.CSSProperties = {
  border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px", background: "transparent",
  color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", cursor: "pointer",
};

export function ArchLensBar({ lens, onLens, onStory }: { lens: ArchLens; onLens: (l: ArchLens) => void; onStory?: () => void }) {
  return (
    <div data-arch-lens-bar style={{ ...panel, position: "absolute", top: "max(84px, calc(var(--vg-toolbar-bottom, 43px) + 8px))", left: 250, zIndex: 30, display: "flex", padding: 4, gap: 4 }}>
      {ARCH_LENSES.map((l) => (
        <button key={l} data-arch-lens={l} data-active={l === lens ? "true" : "false"} onClick={() => onLens(l)}
          style={{
            border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer",
            background: l === lens ? "color-mix(in oklab, var(--accent-thread) 18%, transparent)" : "transparent",
            color: l === lens ? "var(--text-primary)" : "var(--text-secondary)",
            fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
          }}>{LENS_LABEL[l]}</button>
      ))}
      {onStory && (
        <button data-arch-story onClick={onStory} title="Walk the start-here path one edge at a time"
          style={{
            border: "none", borderLeft: "1px solid var(--border-edge)", borderRadius: 0, padding: "4px 8px", cursor: "pointer",
            background: "transparent", color: "var(--accent-thread)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
          }}>Play start-here path</button>
      )}
    </div>
  );
}

export function ArchLegend({ model, hiddenTools = [], hiddenClusters = [], lens, fold }: { model: ArchModelRecord; hiddenTools?: string[]; hiddenClusters?: string[]; lens?: ArchLens; fold?: boolean }) {
  const present = new Set(model.nodes.map((n) => n.category));
  const cats = ARCH_CATEGORIES.filter((c) => present.has(c));
  const u = model.unplaced;
  const left: string[] = [];
  if (u.tests) left.push(`${u.tests} tests`);
  if (u.unmatchedHops) left.push(`${u.unmatchedHops} unmatched hops`);
  if (u.toolsPresentNotCalled.length) left.push(`${u.toolsPresentNotCalled.length} tools present, never called`);
  if (u.unattributedBoundaries) left.push(`${u.unattributedBoundaries} unattributed call sites`);
  if (hiddenTools.length) left.push(lens === "birdseye"
    ? `${hiddenTools.length} less-called tool${hiddenTools.length === 1 ? "" : "s"} (Tools lens)`
    : `${hiddenTools.length} unclassified tool${hiddenTools.length === 1 ? "" : "s"} (Tools lens)`);
  if (hiddenClusters.length) left.push(`${hiddenClusters.length} quieter process${hiddenClusters.length === 1 ? "" : "es"} and dispatchers (Overview)`);
  // Collapsed by default (overlap pass): open, it is a 320px card over the
  // map's lower-left edges. The body stays in the DOM while collapsed, so
  // what the map leaves out is still in its text.
  const [open, setOpen] = React.useState(false);
  // The inspector opens in the same top-right corner: the legend folds away
  // for it rather than sit over its close button.
  React.useEffect(() => { if (fold) setOpen(false); }, [fold]);
  return (
    // TOP-RIGHT, level with the lens bar: above where the map's content
    // starts, so the collapsed pill never sits on a card (bottom-left, it
    // covered a private production codebase's web app card whenever the map ran taller than the
    // screen). Opens downward, over the map, only when asked.
    <div data-arch-legend data-open={open ? "true" : "false"} style={{ ...panel, position: "absolute", top: "max(84px, calc(var(--vg-toolbar-bottom, 43px) + 8px))", right: 16, zIndex: 32, padding: open ? 12 : 0, maxWidth: 320 }}>
      <button data-arch-legend-toggle aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title={open ? "Hide the legend" : "Show the legend"}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: open ? "100%" : undefined,
          background: "none", border: "none", cursor: "pointer", padding: open ? 0 : "8px 12px",
          color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", fontWeight: 600,
          marginBottom: open ? 8 : 0,
        }}>
        Legend
        {!open && left.length > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{`· ${left.length} not drawn`}</span>}
        <span style={{ marginLeft: "auto", display: "flex" }}>{open ? <ChevronUp size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}</span>
      </button>
      <div hidden={!open}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {cats.map((c) => {
          const a = `var(${archVisual(c).accent})`;
          return (
            <span key={c} data-arch-legend-item={c} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 12, height: 8, borderRadius: 2, border: `1px solid ${a}`, background: `color-mix(in oklab, ${a} 20%, transparent)` }} />
              {ARCH_CATEGORY_LABEL[c]}
            </span>
          );
        })}
      </div>
      <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
        solid = seen called · dashed = ambiguous, presence-only or unclassified
      </div>
      {model.primaryPath && (
        <div data-arch-primary-path={model.primaryPath.source} style={{ marginTop: 4 }}
          title={model.primaryPath.source === "proposed" ? `proposed; evidence: ${(model.primaryPath.evidence ?? []).join(", ") || "none — INFERRED"}` : "stated"}>
          {`start here (${model.primaryPath.source}): ${model.primaryPath.entryPoints.join(", ")}`}
        </div>
      )}
      {model.groups.length > 0 && (
        <div style={{ marginTop: 4, color: "var(--text-muted)" }}>
          boxes: solid = stated · dashed = proposed · faint = INFERRED
        </div>
      )}
      {left.length > 0 && (
        <div data-arch-unplaced style={{ marginTop: 4, color: "var(--text-muted)" }} title={model.notes.join("\n")}>
          {`not drawn: ${left.join(" · ")}`}
        </div>
      )}
      </div>
    </div>
  );
}

type Selected = { node: ArchNodeRecord } | { edge: ArchEdgeRecord } | { group: ArchGroupRecord } | null;

/** M-ARCH.4 — the proposal gate. Propose SPENDS TOKENS (one thinking-tier
 *  spawn); what comes back is pending and ghosted until a person ratifies
 *  it here. Nothing a model says becomes stated any other way. */
export function ArchProposalBar({ model, state, onAction }: {
  model: ArchModelRecord;
  state: { busy: boolean; error: string | null };
  onAction?: (action: "propose" | "ratify" | "reject", guidance?: string) => void;
}) {
  const p = model.proposal;
  const [modifying, setModifying] = React.useState(false);
  const [guidance, setGuidance] = React.useState("");
  React.useEffect(() => { if (!p) { setModifying(false); setGuidance(""); } }, [p]);
  const proposedGroups = model.groups.filter((g) => g.source === "proposed").length;
  const proposedNames = model.nodes.filter((n) => n.labelSource === "proposed").length;
  const btn: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 4, border: "1px solid var(--border-edge)", borderRadius: 4,
    padding: "4px 8px", cursor: state.busy ? "default" : "pointer", background: "transparent",
    color: "var(--text-primary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", opacity: state.busy ? 0.6 : 1,
  };
  const why = p ? [p.narrative ?? "", ...p.refused.map((r) => `refused ${r.item}: ${r.reason}`)].filter(Boolean).join("\n") : "";
  return (
    <div data-arch-proposal-bar data-arch-proposal-state={state.busy ? "busy" : p ? "pending" : "none"}
      style={{ ...panel, position: "absolute", top: "max(128px, calc(var(--vg-toolbar-bottom, 43px) + 52px))", left: 250, zIndex: 30, display: "flex", alignItems: "center", gap: 8, padding: 4, maxWidth: 640 }}>
      {!p && (
        <button data-arch-propose disabled={state.busy || !onAction} onClick={() => onAction?.("propose")} style={btn}
          title="Ask a model for deployment / trust groups, names and a primary path — every item must cite a manifest line, a doc line or a node; spends tokens; nothing applies until you ratify">
          <Sparkles size={16} strokeWidth={1.5} />{state.busy ? "Proposing…" : "Propose groups"}
        </button>
      )}
      {p && (
        <>
          <span data-arch-proposal-summary title={why} style={{ padding: "0 4px" }}>
            {`proposal from ${p.model}: ${proposedGroups} groups · ${proposedNames} names${p.refused.length ? ` · ${p.refused.length} refused` : ""}`}
          </span>
          <button data-arch-ratify disabled={state.busy || !onAction} onClick={() => onAction?.("ratify")} style={btn} title="Make this proposal stated (.vibegraph/architecture.json)">
            <Check size={16} strokeWidth={1.5} />Ratify
          </button>
          <button data-arch-modify disabled={state.busy || !onAction} onClick={() => setModifying((m) => !m)} style={btn} title="Ask the model to revise this proposal">
            <Pencil size={16} strokeWidth={1.5} />Modify
          </button>
          <button data-arch-reject disabled={state.busy || !onAction} onClick={() => onAction?.("reject")} style={btn} title="Discard this proposal">
            <X size={16} strokeWidth={1.5} />Reject
          </button>
          {modifying && (
            <form data-arch-modify-form style={{ display: "flex", gap: 4 }}
              onSubmit={(ev) => { ev.preventDefault(); if (guidance.trim()) { onAction?.("propose", guidance.trim()); setModifying(false); } }}>
              <input data-arch-modify-input value={guidance} onChange={(ev) => setGuidance(ev.target.value)} placeholder="what should change?"
                style={{ ...mono, background: "var(--bg-canvas)", color: "var(--text-primary)", border: "1px solid var(--border-edge)", borderRadius: 4, padding: "4px 8px", width: 240 }} />
              <button type="submit" data-arch-modify-send disabled={state.busy || !guidance.trim()} style={btn}>{state.busy ? "Revising…" : "Revise"}</button>
            </form>
          )}
        </>
      )}
      {state.error && <span data-arch-propose-error style={{ color: "var(--text-muted)", padding: "0 4px" }}>{state.error}</span>}
    </div>
  );
}

function GroupInspector({ group, model, onClose }: { group: ArchGroupRecord; model: ArchModelRecord; onClose: () => void }) {
  const labelOf = (id: string) => model.nodes.find((n) => n.id === id)?.label ?? model.groups.find((g) => g.id === id)?.label ?? id;
  const inferred = group.source === "proposed" && !(group.evidence?.length);
  return (
    <div data-arch-inspector data-arch-inspector-group={group.id} style={{ ...panel, position: "absolute", top: 172, right: 16, zIndex: 31, width: 360, maxHeight: "60%", overflowY: "auto", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, color: "var(--text-primary)", fontSize: "var(--fs-13)", fontWeight: 600 }}>{group.label}</div>
        <button data-arch-inspector-close onClick={onClose} title="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div style={{ marginTop: 4 }}>{`${group.kind} · ${group.source === "stated" ? "stated in .vibegraph/architecture.json" : inferred ? "proposed, INFERRED — no evidence cited" : "proposed, not ratified"}`}</div>
      <div style={{ marginTop: 12, color: "var(--text-primary)" }}>wraps</div>
      {group.wraps.map((w) => <div key={w} style={{ ...mono, color: "var(--text-muted)", padding: "2px 0" }}>{labelOf(w)}</div>)}
      {(group.evidence?.length ?? 0) > 0 && (
        <div data-arch-group-evidence style={{ marginTop: 12 }}>
          <div style={{ color: "var(--text-primary)", marginBottom: 4 }}>evidence (checked against what the model was shown)</div>
          {group.evidence!.map((e) => <div key={e} style={{ ...mono, color: "var(--text-muted)", padding: "2px 0", overflowWrap: "anywhere" }}>{e}</div>)}
        </div>
      )}
    </div>
  );
}

export function ArchInspector({ selected, model, onClose, onOpenThread, onReach, onRouteFrom }: {
  selected: Selected;
  model: ArchModelRecord;
  onClose: () => void;
  onOpenThread?: (entryPointId: string) => void;
  onReach?: (id: string, dir: "down" | "up") => void;
  onRouteFrom?: (id: string) => void;
}) {
  if (!selected) return null;
  if ("group" in selected) return <GroupInspector group={selected.group} model={model} onClose={onClose} />;
  const labelOf = (id: string) => model.nodes.find((n) => n.id === id)?.label ?? id;
  const isNode = "node" in selected;
  const title = isNode ? selected.node.label : `${labelOf(selected.edge.from)} → ${labelOf(selected.edge.to)}`;
  const threads = isNode ? selected.node.threads : selected.edge.threads;
  const refs = isNode ? selected.node.refs : selected.edge.refs;
  return (
    <div data-arch-inspector style={{ ...panel, position: "absolute", top: 172, right: 16, zIndex: 31, width: 360, maxHeight: "60%", overflowY: "auto", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, color: "var(--text-primary)", fontSize: "var(--fs-13)", fontWeight: 600 }}>{title}</div>
        <button data-arch-inspector-close onClick={onClose} title="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
      {isNode ? (
        <div style={{ marginTop: 4 }}>
          <div>{selected.node.sublabel}</div>
          {selected.node.labelSource && (
            <div data-arch-label-source={selected.node.labelSource} style={{ marginTop: 4 }}>
              {`name ${selected.node.labelSource}${selected.node.labelSource === "proposed" ? ` (evidence: ${(selected.node.labelEvidence ?? []).join(", ") || "none — INFERRED"})` : ""}; the code calls it ${selected.node.derivedLabel}`}
            </div>
          )}
          {selected.node.roleStatedBy && <div style={{ marginTop: 4 }}>{`role stated by ${selected.node.roleStatedBy} — not a table`}</div>}
          {selected.node.wrappedBy?.length ? <div style={{ marginTop: 4 }}>{`project funnels: ${selected.node.wrappedBy.join(", ")}`}</div> : null}
          {selected.node.members?.length ? (
            <div data-arch-members style={{ marginTop: 8 }}>
              <div style={{ color: "var(--text-primary)", marginBottom: 4 }}>{`${selected.node.members.length} tools in this box (the Tools lens draws each)`}</div>
              {selected.node.members.map((m) => <div key={m} style={{ ...mono, color: "var(--text-muted)" }}>{m.replace(/^tool:/, "")}</div>)}
            </div>
          ) : null}
          {selected.node.dispatches?.length ? <ArchDispatchList node={selected.node} onOpenThread={onOpenThread} /> : null}
          {(onReach || onRouteFrom) && (
            <div data-arch-trace-actions style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
              {onReach && <button data-arch-reach="up" onClick={() => onReach(selected.node.id, "up")} style={traceBtn}>Upstream</button>}
              {onReach && <button data-arch-reach="down" onClick={() => onReach(selected.node.id, "down")} style={traceBtn}>Downstream</button>}
              {onRouteFrom && <button data-arch-route-from onClick={() => onRouteFrom(selected.node.id)} style={traceBtn}>Route from here…</button>}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 4 }}>
          <div data-arch-inspector-protocol style={{ ...mono, color: "var(--text-primary)" }}>{edgeLabel(selected.edge)}</div>
          <div data-arch-inspector-basis style={{ marginTop: 4 }}>{`why: ${selected.edge.protocolBasis}`}</div>
          <div style={{ marginTop: 4 }}>{`${selected.edge.kind === "uses" ? "calls" : `${selected.edge.kind} hops`} · confidence ${selected.edge.confidence}${selected.edge.via?.length ? ` · via ${selected.edge.via.join(", ")}` : ""}`}</div>
        </div>
      )}
      {!isNode && (selected.edge.payloads?.length ?? 0) > 0 && (
        <div data-arch-payloads style={{ marginTop: 12 }}>
          <div style={{ color: "var(--text-primary)", marginBottom: 4 }}>what crosses it</div>
          {selected.edge.payloads!.map((p, i) => (
            <div key={i} data-arch-payload={p.side} data-arch-payload-source={p.source} style={{ padding: "4px 0" }}>
              <span style={{
                ...mono, color: SOURCE_TONE[p.source], marginRight: 8,
                border: `1px solid color-mix(in oklab, ${SOURCE_TONE[p.source]} 45%, transparent)`, borderRadius: 4, padding: "0 4px",
              }}>{p.side === "caller" ? "sends" : p.side === "callee" ? "accepts" : p.side}</span>
              <span style={{ ...mono, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{p.text}</span>
              {p.keys?.length ? <div style={{ ...mono, color: "var(--text-secondary)", marginTop: 2 }}>{`keys: ${p.keys.join(", ")}`}</div> : null}
              {p.note && <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{p.note}</div>}
            </div>
          ))}
        </div>
      )}
      {threads.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: "var(--text-primary)", marginBottom: 4 }}>{`threads (${threads.length})`}</div>
          {threads.slice(0, 12).map((t) => (
            <button key={t} data-arch-open-thread={t} onClick={() => onOpenThread?.(t)} title="Open this thread"
              style={{ ...mono, display: "block", background: "none", border: "none", padding: "2px 0", color: "var(--accent-thread)", cursor: "pointer", textAlign: "left", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</button>
          ))}
          {threads.length > 12 && <div>{`+${threads.length - 12} more`}</div>}
        </div>
      )}
      {refs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: "var(--text-primary)", marginBottom: 4 }}>where in the code</div>
          {refs.map((r, i) => (
            <div key={i} data-arch-ref={r.file} style={{ ...mono, color: "var(--text-muted)", padding: "2px 0", overflowWrap: "anywhere" }}>
              {`${r.file}${r.text ? ` — ${r.text}` : ""}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
