// The stated rules with their live verdicts (2026-10-05, GUI brief M5): asked
// for on mount and after every re-derive (a rule's verdict moves with the
// code), echoed back after each person step. One hook for the toolbar badge,
// the Rules panel and the thread view's "rules on this thread" chip.

import { useEffect, useState } from "react";
import { bridge, type ExtensionMessage } from "./types";
import type { ConstraintRecord } from "../shared/protocol";

export type RuleVerdict = "pass" | "violated" | "unverifiable";
export interface RuleCheckRowView {
  id: string; rule: string; described: string; verdict: RuleVerdict; reason: string;
  offenders: string[]; notFollowed: string[];
  threads: Array<{ entryPointId: string | null; verdict: RuleVerdict; reason: string }>;
}
export interface RuleRowView {
  /** with its history (`changes`, each naming `who`) and open `proposals` */
  constraint: ConstraintRecord;
  verdict: RuleVerdict | null;
  checks: RuleCheckRowView[];
  threads: string[];
  awaiting: boolean;
}
export interface RulesState {
  rules: RuleRowView[];
  pending: number;
  summary: { checked: number; violated: number; unverifiable: number; pass: number };
  person: string;
  error?: string;
  message?: string;
  loaded: boolean;
}

const EMPTY: RulesState = { rules: [], pending: 0, summary: { checked: 0, violated: 0, unverifiable: 0, pass: 0 }, person: "", loaded: false };

export function sendRulesOp(op: "accept" | "reject" | "ratify" | "remove", id: string, pid?: string): void {
  bridge.postMessage({ type: "rules-op", payload: { op, id, ...(pid ? { pid } : {}) } } as never);
}

export function useRulesState(enabled: boolean): RulesState {
  const [state, setState] = useState<RulesState>(EMPTY);
  useEffect(() => {
    if (!enabled) return;
    const ask = () => bridge.postMessage({ type: "rules-get" } as never);
    const handler = (msg: ExtensionMessage) => {
      const t = (msg as { type: string }).type;
      // A person's step is answered with a message, then the re-derive it
      // causes asks again and the second reply carries none: the message
      // stays until the next step says something.
      if (t === "rules-state") {
        const p = (msg as unknown as { payload: Omit<RulesState, "loaded"> }).payload;
        setState((prev) => ({ ...p, loaded: true, ...(p.message || p.error ? {} : { message: prev.message, error: prev.error }) }));
      }
      else if (t === "project-update") ask();
    };
    bridge.onMessage(handler);
    ask();
    return () => bridge.removeListener(handler);
  }, [enabled]);
  return state;
}
