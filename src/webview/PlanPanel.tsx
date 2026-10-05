// The PLAN panel (2026-09-30): the hypothetical project, objective first, and
// how the code measures up — each planned item with its status (PROPOSED /
// agreed / promoted) and its verdict (realised / drifted / not built …).
//
// The person at this panel is the one who AGREES: proposals arrive from Claude
// (MCP vibegraph_plan_edit, the chat) or the CLI, and are agreed, dropped or —
// for a planned rule — promoted into constraints.json here. Everything goes
// through the server's plan_ops, the same rules as every other door.
//
// 2026-10-05 (GUI brief M3/M4): rendered into the panel sheet with a section
// navigation; every item is an ItemFrame (plan/planItems.tsx); the verdict
// counts at the top are a scorecard that filters.

import React, { useState } from "react";
import { DraftingCompass, Check, ArrowUpRight } from "lucide-react";
import type { PlanSection } from "../shared/plan_types";
import { planItemId, sectionItems } from "../shared/plan_types";
import { usePlanState, sendPlanOp, useSoftwareState, sendSoftware } from "./usePlanState";
import { SheetPortal, SheetBody, type SheetSlot } from "./panels/PanelSheet";
import { ItemFrame } from "./panels/ItemFrame";
import { Verdict } from "./panels/Chip";
import { PlanItem, WriteMatrix } from "./plan/planItems";
import { QuestionCard, ResolvedQuestions, AddQuestion, QuestionsSummary } from "./plan/planQuestions";

const small: React.CSSProperties = { fontSize: "var(--fs-12)", color: "var(--text-muted)", lineHeight: 1.5 };
const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--bg-canvas)", color: "var(--text-primary)",
  border: "1px solid var(--border-edge)", borderRadius: 4, padding: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-12)", resize: "vertical",
};
const heading: React.CSSProperties = { fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text-secondary)", margin: "4px 0 0" };

const SECTION_TITLE: Record<PlanSection, string> = {
  processes: "Processes", modules: "Modules", stores: "Stores & zones", principals: "Identities", stack: "Stack",
  boundaries: "Data boundaries", threads: "Threads", flows: "Flows", policies: "Planned rules", open: "Questions",
};
const ORDER: PlanSection[] = ["processes", "modules", "stores", "principals", "stack", "boundaries", "threads", "flows", "policies", "open"];
type NavId = "all" | PlanSection | "writes" | "software" | "changes";

/** Software specs: what each tool is, from its own docs, and its standing. */
function SoftwareSection({ hasPlan }: { hasPlan: boolean }) {
  const { specs, error, message } = useSoftwareState();
  return (
    <div data-software-section data-sheet-section="software" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={heading}>Software specs</h3>
      {!specs.length && (
        <div style={small}>None yet. A spec is drawn from a tool's own documents (every item quotes them) and ratified by you; then the plan, the hooks and the checks build with it in mind. On the command line: <code>vibegraph-knowledge software add &lt;tool&gt; --from &lt;docs url or file&gt;</code> (one model call).</div>
      )}
      {error && <div style={{ ...small, color: "var(--accent-error)" }}>{error}</div>}
      {message && !error && <div style={small}>{message}</div>}
      {specs.map((s) => (
        <ItemFrame key={s.tool} data-software-spec={s.tool} data-software-status={s.status}
          chip={{ kind: "module", id: s.tool }}
          badges={<>
            <Verdict v={s.status} />
            {(s.gate?.inferred.length ?? 0) > 0 && <Verdict v="guess" label={`${s.gate!.inferred.length} inferred`} />}
          </>}
          facts={[{ label: "does", text: s.definition }, { label: "uses", text: `${s.role} · ${s.operations.length} operations · ${s.rules.length} rules · ${s.permissions.length} permissions` }]}
          details={{ summary: `Sources · ${s.sources.length}${s.gate?.dropped.length ? ` · ${s.gate.dropped.length} dropped` : ""}`, body: <p>from {s.sources.map((x) => x.ref).join(", ")}{s.gate?.dropped.length ? ` · dropped (quote not in the docs): ${s.gate.dropped.join("; ")}` : ""}</p> }}
          actions={<>
            {s.status === "draft" && (
              <button className="vg-btn" data-tone="go" data-software-ratify onClick={() => sendSoftware("software-ratify", s.tool)}
                title="Re-check every quote against the saved docs, then accept it — used by the stack, the plan and the hooks from then on">
                <Check size={12} strokeWidth={1.5} /> Ratify
              </button>
            )}
            {s.status === "ratified" && hasPlan && (
              <button className="vg-btn" data-software-plan onClick={() => sendSoftware("software-plan", s.tool)}
                title="Add the tool to the planned stack and its rules as planned rules — all proposed">
                <ArrowUpRight size={12} strokeWidth={1.5} /> Add to plan
              </button>
            )}
          </>}
        />
      ))}
    </div>
  );
}

export function PlanPanel({ open, slot }: { open: boolean; slot: SheetSlot | null }) {
  const { plan, reconcile, error, message } = usePlanState();
  const [objective, setObjective] = useState("");
  const [nav, setNav] = useState<NavId>("all");
  const [only, setOnly] = useState<string | null>(null);
  if (!open || !slot) return null;
  const findings = reconcile?.findings ?? [];
  const offSet = new Set((reconcile?.offObjective ?? []).map((o) => `${o.section}:${o.id}`));
  const live = (s: PlanSection) => (plan ? sectionItems(plan, s).filter((i) => i.status !== "dropped") : []);
  const findingOf = (s: PlanSection, id: string) => findings.find((f) => f.section === s && f.id === id);
  const shown = (s: PlanSection) => live(s).filter((it) => !only || findingOf(s, planItemId(s, it))?.verdict === only);
  const subtitle = plan ? `revision ${plan.revision}${plan.closed ? " · closed" : ""} · hypothetical: a plan, not the code` : "no plan yet";
  const navItems: Array<{ id: NavId; label: string; count?: number }> = plan ? [
    { id: "all", label: "Everything" },
    ...ORDER.filter((s) => s !== "open" && live(s).length).map((s) => ({ id: s as NavId, label: SECTION_TITLE[s], count: live(s).length })),
    { id: "open" as NavId, label: SECTION_TITLE.open, count: plan.open.length },
    ...(reconcile?.writeMatrix?.length ? [{ id: "writes" as NavId, label: "Who writes where" }] : []),
    { id: "software", label: "Software specs" },
    ...(plan.changelog.length ? [{ id: "changes" as NavId, label: "Changes", count: plan.changelog.length }] : []),
  ] : [];
  const showSection = (id: NavId) => nav === "all" || nav === id;
  const backlog = plan ? (["processes", "modules", "stores", "principals", "stack", "boundaries", "threads", "flows", "policies"] as PlanSection[]).reduce((k, sec) => k + sectionItems(plan, sec).filter((i) => i.status === "proposed").length, 0) : 0;

  return (
    <SheetPortal slot={slot} subtitle={subtitle}>
    <SheetBody nav={navItems} active={nav} onNav={(id) => { setNav(id); setOnly(null); }}>
    <div data-plan-panel style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div data-plan-banner style={{ ...small, border: "1px dashed var(--proposed-border)", borderRadius: 8, padding: 8 }}>
        Hypothetical — a plan, not the code. Nothing in it is true of the project until the code says so. Claude proposes; you agree, drop or promote.
      </div>
      {error && <div data-plan-error style={{ ...small, color: "var(--accent-error)" }}>{error}</div>}
      {message && !error && <div style={small}>{message}</div>}

      {!plan ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={small}>No plan yet. Start one with its objective — one line: what it is for. Then ask Claude (the chat, or a hooked Claude Code session) to propose processes, stack, data boundaries, primary threads and rules; they arrive here to agree or drop. On the command line: <code>vibegraph-knowledge plan init</code>.</div>
          <textarea data-plan-objective-input rows={2} style={field} placeholder="e.g. Operators see every pump's wear forecast within a minute of a reading" value={objective} onChange={(e) => setObjective(e.target.value)} />
          <button className="vg-btn" data-plan-start disabled={!objective.trim()} onClick={() => sendPlanOp({ op: "set-objective", text: objective.trim() })}>
            <DraftingCompass size={12} strokeWidth={1.5} /> Start the plan
          </button>
        </div>
      ) : (
        <>
          <div data-plan-objective>
            <div style={small}>Objective</div>
            <div style={{ fontSize: "var(--fs-14)", lineHeight: 1.4 }}>{plan.objective}</div>
          </div>
          {nav === "all" && <QuestionsSummary plan={plan} onJump={() => document.querySelector('[data-plan-section="open"]')?.scrollIntoView({ block: "start" })} />}
          {backlog > 0 && <div data-plan-backlog={backlog} style={{ ...small, color: "var(--accent-warning)" }}>{backlog} proposal{backlog === 1 ? "" : "s"} await review — agree or reject each below (or <code>vibegraph-knowledge plan review</code> for one page with every diff).</div>}
          {reconcile && (
            <div data-plan-counts className="vg-score" title={reconcile.limits.join("\n")}>
              {Object.entries(reconcile.counts).map(([k, n]) => (
                <Verdict key={k} v={k} label={`${n} ${k === "not-built" ? "not built" : k}`} pressed={only === k}
                  onClick={() => setOnly(only === k ? null : k)} />
              ))}
              {only && <button className="vg-sheet-btn" data-plan-filter-clear onClick={() => setOnly(null)}>show all</button>}
            </div>
          )}
          {ORDER.filter((s) => s !== "open" && showSection(s) && shown(s).length).map((s) => (
            <section key={s} data-plan-section={s} data-sheet-section={s} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h3 style={heading}>{SECTION_TITLE[s]}</h3>
              {shown(s).map((it) => {
                const id = planItemId(s, it);
                return <PlanItem key={id} plan={plan} section={s} it={it} finding={findingOf(s, id)} off={offSet.has(`${s}:${id}`)} />;
              })}
            </section>
          ))}
          {/* Questions: open ones in full, adding one (the cap said inline),
              and what was closed or dropped — always reachable. */}
          {showSection("open") && !only && (
            <section data-plan-section="open" data-sheet-section="open" style={{ display: "flex", flexDirection: "column", gap: 8, scrollMarginTop: 48 }}>
              <h3 style={heading}>{`${SECTION_TITLE.open} — ${plan.open.length} open (cap 10)`}</h3>
              {plan.open.map((q) => <QuestionCard key={q.id} q={q} finding={findingOf("open", q.id)} />)}
              <AddQuestion plan={plan} />
              <ResolvedQuestions resolved={plan.resolved ?? []} />
            </section>
          )}
          {only && !ORDER.some((s) => showSection(s) && shown(s).length) && <div style={small}>No item in this section is {only}.</div>}
          {showSection("writes") && !only && (reconcile?.writeMatrix?.length ?? 0) > 0 && (
            <section data-sheet-section="writes" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h3 style={heading}>Who writes where (plan vs code)</h3>
              <WriteMatrix findings={findings} matrix={reconcile!.writeMatrix!} />
            </section>
          )}
          {showSection("changes") && !only && plan.changelog.length > 0 && (
            <section data-plan-changelog style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h3 style={heading}>Recent changes</h3>
              {plan.changelog.slice(nav === "changes" ? -50 : -5).reverse().map((c, i) => <div key={i} style={small}>rev {c.rev} · {c.by} · {c.change}</div>)}
            </section>
          )}
          {nav === "all" && !only && (
            <div>
              <button className="vg-btn" data-plan-close onClick={() => sendPlanOp({ op: plan.closed ? "reopen" : "close" })}
                title={plan.closed ? "Send the plan to hooked sessions again" : "Stop sending the plan to hooked sessions (kept on disk)"}>
                {plan.closed ? "Reopen the plan" : "Close the plan"}
              </button>
            </div>
          )}
        </>
      )}
      {(showSection("software") || !plan) && !only && <SoftwareSection hasPlan={!!plan} />}
    </div>
    </SheetBody>
    </SheetPortal>
  );
}
