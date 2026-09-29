// Thread insight chips (2026-09-28): the two lines every thread contract now
// carries, shown on the thread itself.
//
//   Tests  — the discovered tests that exercise this thread (src/shared/
//            test_reach.ts): "tested · 2", or amber "no test".
//   Config — the environment variables the thread reads (envelope `insight`):
//            "env · 5", amber when any is declared nowhere.
//
// Each chip opens a short list; a test opens its own thread. Flow children of
// ChipStrip, styled like the skill and artifact chips beside them.

import React, { useState } from "react";
import { FlaskConical, KeyRound, X } from "lucide-react";
import type { TestedBy } from "../../shared/test_reach";

const chip = (accent: string): React.CSSProperties => ({
  pointerEvents: "auto",
  display: "flex", alignItems: "center", gap: 8,
  background: "color-mix(in oklab, var(--bg-node) 90%, transparent)",
  border: `1px solid color-mix(in oklab, ${accent} 40%, transparent)`,
  borderRadius: 16, padding: "4px 12px",
  color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)",
  cursor: "pointer",
});

const card: React.CSSProperties = {
  pointerEvents: "auto",
  background: "color-mix(in oklab, var(--bg-node) 96%, transparent)",
  border: "1px solid var(--border-edge)", borderRadius: 8, padding: 12,
  fontFamily: "var(--font-ui)", fontSize: "var(--fs-11)", color: "var(--text-secondary)",
  maxWidth: 420, maxHeight: 280, overflowY: "auto", boxShadow: "var(--shadow-panel)",
};

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)" };

export function ThreadInsightChips({ testedBy, envNames, undeclared, hasDeclarations }: {
  testedBy: TestedBy | undefined;
  envNames: string[];
  undeclared: string[];
  hasDeclarations: boolean;
}) {
  const [open, setOpen] = useState<null | "tests" | "env">(null);
  const nTests = (testedBy?.direct.length ?? 0) + (testedBy?.partial.length ?? 0);
  const testAccent = nTests ? "var(--text-muted)" : "var(--accent-warning)";
  const envAccent = undeclared.length ? "var(--accent-warning)" : "var(--text-muted)";
  const openThread = (entryPointId: string) =>
    document.dispatchEvent(new CustomEvent("vg-open-thread", { detail: { entryPointId } }));
  if (!testedBy && envNames.length === 0) return null;
  return (
    // One row in the chip strip for both chips (a column entry each pushed
    // the strip's height down onto the canvas), the list below them.
    <div data-thread-insight-chips style={{ display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      <div style={{ display: "flex", gap: 8 }}>
      {testedBy && (
        <button data-thread-tests-chip data-test-count={nTests} onClick={() => setOpen(open === "tests" ? null : "tests")}
          title="The discovered tests that exercise this thread" style={chip(testAccent)}>
          <FlaskConical size={16} strokeWidth={1.5} style={{ color: testAccent }} />
          {nTests ? `tested · ${nTests}` : "no test"}
        </button>
      )}
      {envNames.length > 0 && (
        <button data-thread-env-chip data-env-count={envNames.length} data-env-undeclared={undeclared.length}
          onClick={() => setOpen(open === "env" ? null : "env")}
          title="The environment variables this thread reads" style={chip(envAccent)}>
          <KeyRound size={16} strokeWidth={1.5} style={{ color: envAccent }} />
          {`env · ${envNames.length}${undeclared.length ? ` (${undeclared.length} undeclared)` : ""}`}
        </button>
      )}
      </div>
      {open && (
        <div data-thread-insight-card={open} style={card}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <div style={{ flex: 1, color: "var(--text-primary)", fontWeight: 600 }}>
              {open === "tests" ? "Tested by" : "Configured by"}
            </div>
            <button onClick={() => setOpen(null)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
          {open === "tests" && (nTests === 0
            ? <div>No discovered test reaches this thread. A test runner discovery cannot see would not show here either — "no discovered test", not "untested".</div>
            : [
              ...(testedBy!.direct.map((t) => ({ t, why: "reaches the entry point" }))),
              ...(testedBy!.partial.map((p) => ({ t: p.entryPointId, why: `reaches ${p.steps} of its steps` }))),
            ].map(({ t, why }) => (
              <div key={t} style={{ padding: "4px 0" }}>
                <button data-open-test={t} onClick={() => openThread(t)}
                  style={{ ...mono, background: "none", border: "none", padding: 0, color: "var(--accent-thread)", cursor: "pointer", textAlign: "left" }}>{t}</button>
                <span style={{ color: "var(--text-muted)" }}>{` — ${why}`}</span>
              </div>
            )))}
          {open === "env" && (
            <>
              {envNames.map((n) => (
                <div key={n} data-env-var={n} style={{ padding: "4px 0" }}>
                  <span style={mono}>{n}</span>
                  {undeclared.includes(n) && <span style={{ color: "var(--accent-warning)" }}>{" — declared nowhere (.env.example / compose)"}</span>}
                </div>
              ))}
              {!hasDeclarations && <div style={{ marginTop: 8, color: "var(--text-muted)" }}>The project declares no environment, so nothing is checked against a declaration.</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
