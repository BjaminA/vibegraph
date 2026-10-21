// "NOW" (2026-10-16, from a GUI review: the app showed its knowledge as lists
// behind a wall of buttons, and nothing said what state the project is in or
// what to do next). One small summary, computed where the facts are:
// the objective, what waits for a person, stale Brief lines, open questions,
// the stated rules, the project's direction — and ONE next step, chosen by a
// fixed order (never a model), each pointing at the panel that acts on it.
//
// 2026-10-20 — the order after "decisions waiting" and "stale Brief lines" is
// the SETUP's (setup_state.ts): software specs, groups, the Brief, rules, the
// objective and principles, direction, hooks — one order for the app, the
// `setup` command and the /vibegraph-setup skill.

import { framingFacts } from "./hooked_framing.ts";
import { buildInbox } from "./inbox.ts";
import { loadDirection } from "./project_direction.ts";
import { setupState } from "./setup_state.ts";
import { offerWelcome } from "./setup_welcome.ts";
import type { StackIndexRecord } from "../shared/protocol.ts";
import type { NowState } from "../shared/now_wire.ts";

export function nowState(root: string, opts: { briefStale?: string[]; stack?: Pick<StackIndexRecord, "tools"> | null } = {}): NowState {
  const f = framingFacts(root);
  let items: ReturnType<typeof buildInbox> = [];
  try { items = buildInbox(root); } catch { items = []; }
  const waiting = items.filter((i) => i.decidable);
  const d = (() => { try { return loadDirection(root); } catch { return { version: "1" as const, rules: [] }; } })();
  const direction = { agreed: d.rules.filter((r) => r.status === "agreed").length, proposed: d.rules.filter((r) => r.status === "proposed").length };
  const briefStale = opts.briefStale?.length ?? 0;
  const byKind = (k: string) => waiting.filter((i) => i.kind === k).length;
  const setup = (() => { try { return setupState(root, { stack: opts.stack ?? null }); } catch { return null; } })();
  const next: NowState["next"] =
    waiting.length ? { text: `${waiting.length} decision${waiting.length === 1 ? " waits" : "s wait"} for you`, panel: "inbox" }
      : briefStale ? { text: `${briefStale} Brief line${briefStale === 1 ? " is" : "s are"} stale — re-brief them`, panel: null }
        : setup?.next ? setup.next.now
          : { text: "Start a task with Claude Code", panel: "agents" };
  return {
    objective: f.objective, waiting: waiting.length, openQuestions: f.openQuestions.length, briefStale, rules: f.rules, direction,
    badges: { inbox: waiting.length, plan: byKind("plan") + byKind("objective"), direction: direction.proposed },
    next,
    ...(setup ? { setup: {
      done: setup.done, of: setup.of, ...(setup.next ? { next: setup.next.id } : {}),
      steps: setup.steps.map((s) => ({ id: s.id, title: s.title, status: s.status, core: s.core, spends: s.commands.some((c) => !!c.spends), decides: s.commands.some((c) => c.who === "you"), now: s.now })),
      welcome: (() => { try { return offerWelcome(root); } catch { return false; } })(),
    } } : {}),
  };
}
