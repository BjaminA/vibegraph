// M-SKILL.2 — remit-routing provenance line (extracted from ChatPanel
// in M-CHAT-POLISH.4's line-ceiling pass, verbatim). A muted
// information line above the reply, never decoration: names each
// matched thread and says honestly whether its skill rode the prompt.
import React from "react";
import { Waypoints } from "lucide-react";
import type { RoutedSegment } from "./chat_store";

export function RoutedLine({ seg }: { seg: RoutedSegment }) {
  return (
    <div
      data-chat-routed
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        fontSize: 11,
        color: "var(--text-muted)",
        fontFamily: "monospace",
        padding: "4px 0",
        lineHeight: 1.5,
      }}
    >
      <Waypoints size={16} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        {seg.matches.map((m) => (
          <span key={m.entryPointId} style={{ display: "block" }}>
            routed: this question touches thread {m.qualifiedName} (matched {m.matchedOn.join(", ")})
            {m.skillInjected ? " — its ratified skill was shared with the agent" : ""}
            {m.skillStale ? " — its ratified skill is stale (thread changed since review) and was withheld" : ""}
            {m.skillMissing === "absent" ? " — no skill drafted for this thread yet" : ""}
            {m.skillMissing === "draft" ? " — its skill is a draft awaiting ratification" : ""}
            {m.skillOverBudget ? " — its ratified skill exceeded this turn's injection budget and was withheld" : ""}
            {m.skillAlreadyShared ? " — its ratified skill was already shared earlier in this session" : ""}
          </span>
        ))}
        {/* The question was about the thread already open. Routing skips it
            on purpose — its full context (nodes, skill, artifacts) is
            already in the prompt — but saying nothing made that
            indistinguishable from "matched nothing". */}
        {seg.selfMatch && (
          <span data-chat-routed-self style={{ display: "block" }}>
            already in context: this question is about {seg.selfMatch.qualifiedName} — the
            thread you have open (matched {seg.selfMatch.matchedOn.join(", ")}). Its full
            context is already in the prompt, so it was not routed again.
          </span>
        )}
      </span>
    </div>
  );
}
