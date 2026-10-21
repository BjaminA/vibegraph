// The "now" summary's wire shape (src/server/now_state.ts), webview-safe.

/** a sheet panel, or "setup": the setup guide, where a step Claude runs is run (2026-10-21) */
export type NowPanel = "inbox" | "plan" | "rules" | "direction" | "agents" | "setup";
export type SheetPanel = Exclude<NowPanel, "setup">;

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
  setup?: {
    done: number; of: number;
    /** the setup step that comes next (setup_state.ts `next`), when one does */
    next?: string;
    /** 2026-10-21 — each step in order, for the setup guide (SetupGuide.tsx) */
    steps?: SetupStepSummary[];
    /** a new project this person has not set aside: the app offers the setup (setup_welcome.ts) */
    welcome?: boolean;
  };
}

export interface SetupStepSummary {
  id: string;
  title: string;
  status: "done" | "waiting" | "todo" | "optional" | "skipped";
  core: boolean;
  /** comes after the setup and is not counted in it (the plan) */
  after?: boolean;
  /** some command of the step asks a model */
  spends: boolean;
  /** some command of the step is a person's decision */
  decides: boolean;
  now: { text: string; panel: NowPanel | null };
}
