---
name: repetition-cost
description: >-
  Use when the packet writes or changes a loop, a comprehension, or a
  generator on a thread that calls a db or http-client role, or when the
  task claims something is faster.
version: 1.0
last-updated: 2026-09-22
dimension: repetition-cost
applies_when: {"any":[{"fact":"rolesCalled","has":"db"},{"fact":"rolesCalled","has":"http-client"},{"fact":"rolesCalled","has":"remote"}]}
binds: ["check:not-in-loop","envelope:contract.roundTrips","envelope:observations","judgement"]
derivedFrom: ["AS-10","PT-4","AS-14","VG-1","VG-3"]
evidence: validated
drill: reviews/skills/drills/repetition-cost.md
---

## Purpose

A round trip inside a loop is a round trip per item, however the loop is
spelled. This skill says how the contract already reports repetition, what
the one verb proves, and what a performance claim needs before it may be
called anything but a claim.

## Applies when

The thread itself calls a db, http-client or remote role. Not the
project-level "effectful loops somewhere" fact: a thread inherits project
facts it does not carry, and that would put round-trip direction in front
of a worker on a thread with no external at all.

## Rules and why

- **Read the contract's round trips per loop before writing a loop, and expect a new one to appear there if you add one.** — why: the contract walks the thread through every loop container — `for`, `while`, list / set / dict / generator comprehension, and each `for` clause of a multi-clause comprehension — and lists the external calls under each by label. A comprehension is a loop; the verdict does not depend on spelling (M-COMP). — bound: envelope:contract.roundTrips
- **No per-item external call inside a loop; batch at the funnel instead.** — why: `[requests.get(u).json() for u in ids]` is N requests. Where a constraint names the target or the role, `not-in-loop` walks the thread through project callees and names the loop and the call; a call inside a function the constraint lists in `except` is judged on that funnel's own body once. — bound: check:not-in-loop
- **A loop the SOURCE fixes is not a repetition.** — why: a migration loop over a literal list of statements runs as many times as the list is long, decided at write time, and the first cut of the verb flagged every such loop on every h2h3 arm. Calibrated 2026-09-21: a loop whose iterable is a literal is out of the verb's scope, and the skill says so, so you do not unroll one to please a check. — bound: check:not-in-loop
- **"Faster" is a measurement with `observed` provenance or it is a claim.** — why: the corpus's one measured source (ponytail's benchmark) is the one whose outcome can be checked; the rest assert. Here a trace run annotates every call site an entry point touched, and Observe reports what a receiver actually was; both land in the observations overlay beside the IR, never in it, and are stale per file. Cite the overlay or mark the claim unverified — an unmeasured improvement is `unverifiable`, never a pass. — bound: envelope:observations
- **Keep a change only when the measured improvement exceeds run-to-run variance; revert a neutral one.** — why: a change kept as "neutral" carries its complexity forever for nothing. This is judgement over the measurement; nothing checks it. — bound: judgement

## What this cannot check

- How many times a loop iterates; the verb reports repetition, not cost.
- Whether a generator expression is ever consumed (G5): `sum(fetch(u) for u in urls)` and a genexp assigned and dropped look the same.
- A `dynamic` call inside a loop with no effect kind: `unverifiable`, naming the loop and the call, unless the observations overlay resolves it.
- Timing, latency, throughput: the IR has no clock; only a trace does, and only for the run it saw.

## Refused from the source

- Core Web Vitals targets, pool sizes, cache TTLs, index rules — reason: numbers and regimes outside the IR (brief C.8; AS-11 declined as regime-dependent).
- "Cache keys must include every input" — reason: dissolved to "the cache is correct" (AS-13), no structure.
- "Paginate list endpoints" — reason: a regex over literal call text, regime-dependent (RUN1 2.2).
- The five-step measure / identify / fix / verify / guard procedure — reason: process prose; the floor is the provenance rule above.
