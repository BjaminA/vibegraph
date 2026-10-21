// The rule form's scope, picked from grouped, coloured chips (2026-10-19,
// PLAN-M-RULES M1). Groups come from scopeGroups.ts (facts only); each chip
// is a toggle in its kind's colours (kinds.ts through the .vg-chip tokens);
// the line under the search says which threads the scope reaches, computed
// with the server's own routing predicate (shared/scope_route.ts) — so a
// person sees what a rule will reach before stating it.

import React, { useMemo, useState } from "react";
import { Check, ChevronRight, ChevronDown, Search, X } from "lucide-react";
import { KINDS } from "../../shared/kinds";
import { KIND_ICON } from "../panels/Chip";
import { buildScopeGroups, reachOf, scopeOfPicked, type ScopeInput, type ScopeOption } from "./scopeGroups";
import type { RuleScope } from "../../shared/scope_route";

const SHOWN = 12;
const small: React.CSSProperties = { fontSize: "var(--fs-11)", color: "var(--text-muted)" };

function ScopeChip({ o, on, onToggle, removable }: { o: ScopeOption; on: boolean; onToggle: () => void; removable?: boolean }) {
  const k = KINDS[o.kind];
  const Icon = KIND_ICON[o.kind];
  return (
    <button type="button" className="vg-chip vg-scope-chip" data-chip={o.kind} data-scope-option={o.key} aria-pressed={on}
      data-dashed={k.dashed ? "true" : undefined} style={{ "--h": k.hue, "--s": `${k.sat}%` } as React.CSSProperties}
      title={`${o.title}${on ? " — picked; click to remove" : " — click to add to the scope"}`} onClick={onToggle}>
      <Icon size={12} strokeWidth={1.5} aria-hidden />
      <span className="vg-scope-label">{o.label}</span>
      {/* a thread always reaches itself: its count says nothing, so only a 0 (no thread yet) is shown */}
      {removable ? <X size={12} strokeWidth={1.5} aria-hidden /> : (!o.key.startsWith("ep:") || o.reaches === 0) && <span className="vg-scope-n" title={`reaches ${o.reaches} thread(s)`}>{o.reaches}</span>}
    </button>
  );
}

/** The picked keys and "all threads" are owned by the form; this draws and reports. */
export function ScopePicker({ input, picked, onPicked, all, onAll, typed }: {
  input: ScopeInput;
  picked: readonly string[];
  onPicked: (keys: string[]) => void;
  all: boolean;
  onAll: (v: boolean) => void;
  /** the typed escape hatch, already parsed — counted in the preview */
  typed: RuleScope;
}) {
  const groups = useMemo(() => buildScopeGroups(input), [input]);
  const byKey = useMemo(() => new Map(groups.flatMap((g) => g.subgroups.flatMap((s) => s.options)).map((o) => [o.key, o])), [groups]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [more, setMore] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const pickedOpts = picked.map((k) => byKey.get(k)).filter((o): o is ScopeOption => !!o);
  const toggle = (key: string) => onPicked(picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]);

  const scope = all ? { all: true } : scopeOfPicked([...pickedOpts, { key: "typed", kind: "path", label: "", title: "", adds: typed, reaches: 0 }]);
  const empty = !all && !scope.entryPointIds?.length && !scope.files?.length && !scope.stack?.length;
  const reached = empty ? [] : reachOf(scope, input);
  const total = input.threads.length;
  const names = reached.map((t) => t.entryPointId).filter((x): x is string => !!x);

  return (
    <div data-scope-picker style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: 1, minWidth: 200, border: "1px solid var(--border-edge)", borderRadius: 6, padding: "4px 8px" }}>
          <Search size={16} strokeWidth={1.5} color="var(--text-muted)" aria-hidden />
          <input data-scope-search value={query} onChange={(e) => setQuery(e.target.value)} placeholder="find a thread, script, tool or folder"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)" }} />
        </label>
        <button type="button" className="vg-btn" data-scope-all aria-pressed={all} onClick={() => onAll(!all)}
          title="A rule for every thread — the scope picks below are ignored while this is on">
          {all && <Check size={16} strokeWidth={1.5} aria-hidden />}every thread
        </button>
      </div>

      <div data-scope-preview style={small}>
        {all ? <>Reaches <b>every thread</b> ({total}).</>
          : empty ? <>Pick what the rule is about. With nothing picked it is stated for every thread.</>
            : <>Reaches <b data-scope-reach={reached.length}>{reached.length}</b> of {total} threads{names.length ? <>: <span style={{ fontFamily: "var(--font-mono)" }}>{names.slice(0, 4).join(", ")}{names.length > 4 ? `, +${names.length - 4}` : ""}</span></> : " — nothing reaches it yet; a tool scope starts routing once code uses the tool"}.</>}
      </div>

      {pickedOpts.length > 0 && (
        <div data-scope-picked style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", opacity: all ? 0.5 : 1 }}>
          <span style={small}>scope</span>
          {pickedOpts.map((o) => <ScopeChip key={o.key} o={o} on onToggle={() => toggle(o.key)} removable />)}
        </div>
      )}

      {groups.map((g) => {
        const isOpen = q ? true : open[g.id] ?? !g.folded;
        const subs = g.subgroups.map((s) => ({ ...s, options: q ? s.options.filter((o) => `${o.label} ${o.title}`.toLowerCase().includes(q)) : s.options })).filter((s) => s.options.length);
        if (!subs.length) return null;
        const count = subs.reduce((n, s) => n + s.options.length, 0);
        const Chevron = isOpen ? ChevronDown : ChevronRight;
        return (
          <section key={g.id} data-scope-group={g.id} data-open={isOpen ? "true" : undefined} style={{ borderTop: "1px solid var(--border-edge)", paddingTop: 8 }}>
            <button type="button" onClick={() => setOpen((v) => ({ ...v, [g.id]: !isOpen }))} aria-expanded={isOpen}
              style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-primary)", textAlign: "left" }}>
              <Chevron size={16} strokeWidth={1.5} style={{ alignSelf: "center" }} aria-hidden />
              <b style={{ fontSize: "var(--fs-13)" }}>{g.label}</b>
              <span data-scope-group-count style={small}>{count}</span>
              <span style={{ ...small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.hint}</span>
            </button>
            {isOpen && subs.map((s) => {
              const k = `${g.id}/${s.label}`;
              const shown = q || more[k] ? s.options : s.options.slice(0, SHOWN);
              return (
                <div key={k} data-scope-subgroup={s.label} style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", margin: "8px 0 0 24px" }}>
                  <span style={{ ...small, textTransform: "uppercase", letterSpacing: "0.05em", width: "100%" }}>{s.label} · {s.options.length}</span>
                  {shown.map((o) => <ScopeChip key={o.key} o={o} on={picked.includes(o.key)} onToggle={() => toggle(o.key)} />)}
                  {s.options.length > shown.length && (
                    <button type="button" className="vg-btn" data-scope-more onClick={() => setMore((v) => ({ ...v, [k]: true }))}>+{s.options.length - shown.length} more</button>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
