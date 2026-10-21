// The "now" summary's wire shape (src/server/now_state.ts), webview-safe.

export type NowPanel = "inbox" | "plan" | "rules" | "direction" | "agents";

export interface NowState {
  objective: string | null;
  /** decisions waiting for a person (the Inbox's decidable items) */
  waiting: number;
  openQuestions: number;
  briefStale: number;
  rules: number;
  direction: { agreed: number; proposed: number };
  /** counts for the panel switcher's tabs */
  badges: { inbox: number; plan: number; direction: number };
  /** the one next step, by a fixed order; `panel` null = on the map (the Brief card) */
  next: { text: string; panel: NowPanel | null };
  /** 2026-10-20 — the setup's progress (src/server/setup_state.ts) */
  setup?: { done: number; of: number };
}
