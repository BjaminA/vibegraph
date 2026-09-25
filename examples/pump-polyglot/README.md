# Example 3 — Pump wear, four languages (the orchestrated drill)

**The same pump-wear model as [Example 1](../pump-wear), wrapped the way
a real service is:** a Flask API over the model (`api.py`), a TypeScript
Express dashboard that talks to it over HTTP (`dashboard/`), a bash
pipeline that trains, builds, and smoke-tests it (`ops/`), and a C++
window-statistics tool the pipeline builds and runs (`native/`).

Nothing here links across a language boundary — VibeGraph refuses to
guess. Every hop between languages is an honest external terminal named
from each side's own code: `fetch` in TS is `http`; `curl` in bash is
`http`; `python3 train.py` in bash is `subprocess`; `make -C native` is
`subprocess`. What the IR *does* know is the **data contract** of each
thread: `{readings: number[8]}` goes in, `{wear: number}` comes out, and
three of the threads pay one round trip per row inside a loop —
`postBatch` (TS, an HTTP `fetch`), `smoke_predict` (bash, a `curl`) and
the native reader (C++, an `fgets` per line). (`evaluate_holdout`'s loop
is pure compute — the contract does NOT flag it, on purpose.)

The C++ one is worth a word, because it appeared only in 2026-09-21. The
read is written in the loop's own CONDITION — `while (fgets(line, sizeof
line, csv) != nullptr)` — and until the expression-position walk landed,
a call in a condition produced no IR node at all, so the contract could
not see it. The finding is correct by the detector's own definition
(`ROUND_TRIP_EFFECTS` includes `fs`) and it is a cheaper trip than the
other two: a buffered line read, not a network hop. That the three now
sit side by side is the point — the contract reports the SHAPE, and what
each round trip costs is the reader's judgement, not the IR's.

## What to look at

| where | what VibeGraph shows |
| --- | --- |
| Launchpad | `api.py:predict_route` + `health` (flask), `dashboard/server.ts:postReading` / `postBatch` / `getHealth` (express), `ops/pipeline.sh:main` (shell), `native/main.cpp:main` (cli), two gtest rows |
| `postBatch` thread | the loop container holds `postToApi` → `fetch [http]` — the N+1 the contract flags |
| `native/main.cpp:main` thread | `smooth` is `unresolved`: two overloads exist and the linker will not pick |
| any thread's contract (`vibegraph_thread_contract`) | params in, declared return out, every effectful call with its literal text, the round trips, where knowledge ends |

## The orchestrated drill (real `claude` calls)

```bash
cd /path/to/VibeGraph
cp -r examples/pump-polyglot /tmp/pump-polyglot-drill     # never edit the example itself
PORT=4299 node dist/server.js /tmp/pump-polyglot-drill &   # boot headless
node scripts/drive_work_run.mjs --port 4299 --mode orchestrated \
  --task "reject readings that are not 8 finite numbers: \`predict_route\` in api.py returns 400 with an error message, \`validateReading\` in dashboard/schema.ts checks the same rule, and \`smoke_predict\` in ops/pipeline.sh logs each response with \`log_step\`"
```

The drive script prints the orchestrator's brief (objective, each
packet's task and handoff), confirms the objective once, then streams
every packet transition, the orchestrator's verdicts, and the honest
run summary. Escalations stop it and tell you why — they are yours to
resolve in the board.

Pinned by `npm run test:example-pump-polyglot`.
