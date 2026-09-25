---
key: thread:telemetry/alerts.py:evaluate
entryPointId: telemetry/alerts.py:evaluate
status: ratified
sourceHash: sha256:fixture-thread-hash
generatedAt: 2026-09-12T00:00:00.000Z
---

# evaluate — thread skill (FIXTURE for the manifest deriver)

This file is a test fixture in thread_skill_store.ts's on-disk format. It
is not a real skill: no worker drafted it and no human ratified it. Its
`## Rules and why` section holds one bullet of each shape the deriver
must handle: cited constraint with why and nodes; worker observation with
why and nodes; a bullet with neither.

## What this thread does

Evaluates a reading against its threshold and pages operators.

## Rules and why

- **Page operators only through `notify`, after `should_notify` has applied its dedup** (c3) — because a flapping sensor once paged the on-call forty times in a minute. Governs telemetry/alerts.py:module/evaluate.fn/notify.call and telemetry/alerts.py:module/should_notify.fn.
- Never build the event dict twice in one evaluation — why: `_events` is appended on every page, and a second append double-counts (telemetry/alerts.py:module/notify.fn/_events_append.call).
- Keep the evaluate loop cheap.

## Named terminals

- `_session().post` in http_client (external, requests via telemetry.http_client)
