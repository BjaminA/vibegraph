// The app's model tasks as the server says them (src/server/gui_tasks.ts): one
// store that the Brief card, the groups bar, the Rules panel and the bubble
// over the chat button all read. A panel that closes and reopens reads its
// task back from here; nothing about a task lives in the panel that started it.

import { useSyncExternalStore } from "react";
import { bridge, type ExtensionMessage } from "../types";

export type GuiTaskKind = "brief" | "groups" | "rules";
export interface GuiTaskStep { at: string; text: string; live?: boolean }
export interface GuiTask {
  id: string;
  kind: GuiTaskKind;
  label: string;
  /** where its result is read: "map" or a panel id ("rules") */
  open: string;
  startedAt: string;
  endedAt?: string;
  state: "running" | "done" | "failed";
  steps: GuiTaskStep[];
  summary?: string;
  error?: string;
  result?: unknown;
}

let tasks: GuiTask[] = [];
const subscribers = new Set<() => void>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  bridge.onMessage((m: ExtensionMessage) => {
    const x = m as unknown as { type: string; payload?: { tasks?: GuiTask[] } };
    if (x.type !== "gui-tasks" || !Array.isArray(x.payload?.tasks)) return;
    tasks = x.payload.tasks;
    for (const s of subscribers) s();
  });
  bridge.postMessage({ type: "gui-tasks-get" } as never);
}

const subscribe = (cb: () => void) => { listen(); subscribers.add(cb); return () => { subscribers.delete(cb); }; };
const snapshot = () => tasks;

/** Every task the server holds: the running ones and the last few finished. */
export function useGuiTasks(): GuiTask[] {
  return useSyncExternalStore(subscribe, snapshot);
}

/** The newest task of one kind, running or finished. */
export function useGuiTask(kind: GuiTaskKind): GuiTask | null {
  const all = useGuiTasks();
  for (let i = all.length - 1; i >= 0; i--) if (all[i].kind === kind) return all[i];
  return null;
}

/** A finished task dismissed: it leaves every client, and its panel's result with it. */
export function dismissGuiTask(id: string): void {
  bridge.postMessage({ type: "gui-task-dismiss", payload: { id } } as never);
}

// Opening a task's place on the map from another view (the bubble, the setup
// guide): the map and its Brief card mount AFTER the view switches, so an
// event sent in the same tick reaches nobody. The request waits here and each
// listener takes it when it mounts; the event still serves a map already open.
let pendingOpen: { kind: GuiTaskKind; at: number } | null = null;
export function requestMapOpen(kind: GuiTaskKind): void {
  pendingOpen = { kind, at: Date.now() };
  document.dispatchEvent(new CustomEvent("vg-open-task", { detail: { kind } }));
}
/** a request made in the last few seconds that `kind` has not taken yet */
export function pendingMapOpen(): GuiTaskKind | null {
  return pendingOpen && Date.now() - pendingOpen.at < 10_000 ? pendingOpen.kind : null;
}
export function takeMapOpen(kind: GuiTaskKind): boolean {
  if (pendingMapOpen() !== kind) return false;
  pendingOpen = null;
  return true;
}

// A finished task OPENED from the bubble leaves this client's bubble but stays
// on the server, so the panel it opens can still show its result.
const seen = new Set<string>();
export const isGuiTaskSeen = (id: string) => seen.has(id);
export function markGuiTaskSeen(id: string): void {
  seen.add(id);
  tasks = [...tasks];
  for (const s of subscribers) s();
}
