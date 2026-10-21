// THE APP'S MODEL TASKS (2026-10-21, Ben: "if running a task in GUI like
// propose rules - should continue to run even if it hit close on the popup
// … a message over the chat icon … if a task is running or complete").
//
// A token-spending action the app starts (draft the Brief, propose groups,
// propose rules) is a TASK the server owns. It runs to its end whatever the
// panel that started it does, and every client hears where it is: what it is
// doing now, for how long, and how it ended. A panel that closes and reopens
// reads its task back; the bubble over the chat button shows it from
// anywhere. One task of a kind at a time: a second start is refused with the
// running one named, never queued behind it.

export type GuiTaskKind = "brief" | "groups" | "rules";

export interface GuiTaskStep { at: string; text: string; live?: boolean }

export interface GuiTask {
  id: string;
  kind: GuiTaskKind;
  label: string;
  /** where its result is read: "map" (the Brief card, the groups bar) or a panel id ("rules") */
  open: string;
  startedAt: string;
  endedAt?: string;
  state: "running" | "done" | "failed";
  /** what it did, newest last; a `live` step (a counter) is replaced by the next live one */
  steps: GuiTaskStep[];
  summary?: string;
  error?: string;
  /** what the panel that started it shows when it reopens (kind-specific) */
  result?: unknown;
}

export interface GuiTaskHandle {
  id: string;
  /** a step done or begun; `live` = a counter the next live step replaces */
  step(text: string, live?: boolean): void;
  done(summary: string, result?: unknown): void;
  fail(error: string): void;
}

const STEP_KEEP = 8;
const FINISHED_KEEP = 6;
const THROTTLE_MS = 300;

export interface GuiTasks {
  start(kind: GuiTaskKind, label: string, open: string): GuiTaskHandle | { refused: string };
  running(kind: GuiTaskKind): GuiTask | null;
  list(): GuiTask[];
  dismiss(id: string): void;
}

export function createGuiTasks(broadcast: (tasks: GuiTask[]) => void, now: () => Date = () => new Date()): GuiTasks {
  const tasks: GuiTask[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const list = (): GuiTask[] => tasks.map((t) => ({ ...t, steps: t.steps.map((s) => ({ ...s })) }));
  const flush = () => { timer = null; broadcast(list()); };
  // a start or an end is said at once; steps are batched (a stream sends many)
  const changed = (urgent: boolean) => {
    if (urgent) { if (timer) clearTimeout(timer); flush(); }
    else if (!timer) timer = setTimeout(flush, THROTTLE_MS);
  };
  const running = (kind: GuiTaskKind) => tasks.find((t) => t.kind === kind && t.state === "running") ?? null;

  function start(kind: GuiTaskKind, label: string, open: string): GuiTaskHandle | { refused: string } {
    const busy = running(kind);
    if (busy) return { refused: `${busy.label} is already running (since ${busy.startedAt.slice(11, 19)}); it carries on whether its panel is open or not` };
    const at = now();
    const t: GuiTask = { id: `${kind}-${at.getTime().toString(36)}`, kind, label, open, startedAt: at.toISOString(), state: "running", steps: [] };
    tasks.push(t);
    const finished = tasks.filter((x) => x.state !== "running");
    for (const old of finished.slice(0, Math.max(0, finished.length - FINISHED_KEEP))) tasks.splice(tasks.indexOf(old), 1);
    changed(true);
    const end = (fields: Partial<GuiTask>) => {
      if (t.state !== "running") return;
      Object.assign(t, fields, { endedAt: now().toISOString() });
      changed(true);
    };
    return {
      id: t.id,
      step(text, live = false) {
        if (t.state !== "running" || !text) return;
        const last = t.steps[t.steps.length - 1];
        if (last && last.text === text) return;
        const s: GuiTaskStep = { at: now().toISOString(), text, ...(live ? { live: true } : {}) };
        if (live && last?.live) t.steps[t.steps.length - 1] = s;
        else t.steps.push(s);
        if (t.steps.length > STEP_KEEP) t.steps.splice(0, t.steps.length - STEP_KEEP);
        changed(false);
      },
      done(summary, result) { end({ state: "done", summary, ...(result !== undefined ? { result } : {}) }); },
      fail(error) { end({ state: "failed", error }); },
    };
  }

  function dismiss(id: string): void {
    const i = tasks.findIndex((t) => t.id === id && t.state !== "running");
    if (i >= 0) { tasks.splice(i, 1); changed(true); }
  }

  return { start, running, list, dismiss };
}
