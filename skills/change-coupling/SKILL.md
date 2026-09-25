---
name: change-coupling
description: >-
  Use when the packet changes a stored shape — a table, a serialised file,
  a wire format — or changes project code on a project that has tests.
version: 1.0
last-updated: 2026-09-22
dimension: change-coupling
applies_when: {"any":[{"fact":"rolesCalled","has":"db"},{"fact":"testsPresent","has":"true"}]}
binds: ["check:co-changes","envelope:plan.systemPackets","precheck:tests-touched","precheck:loosening-loud","judgement"]
derivedFrom: ["AS-21","AS-5","AS-1","PT-2","AS-6"]
evidence: unvalidated
---

## Purpose

Some changes are only correct in pairs: a schema with its migration, a
behaviour with the test that pins it. This skill says which pairs the run
can see, at what level it sees them, and which half it cannot.

## Applies when

The thread calls a db role, or the project has tests present.

## Rules and why

- **A change to a stored shape ships with its migration, in the same run.** — why: `create table if not exists` does not add a column to a database that already exists; every live install was created before your change. With that fact stated (fleet c6), the brief proposed the migration module, the worker created it through the chokepoint, and the reviewer ran it against an old database. `co-changes` evaluates over the RUN's combined delta — the migration may be another packet's work, and a packet reviewed before that packet ran is `not-yet`, not `violated`. — bound: check:co-changes
- **Work no thread owns — a migration, a new module, an integration point — is a SYSTEM PACKET the brief proposes and a human confirms.** — why: a note that names the gap and leaves it is the failure this mechanism exists to end. If the objective changes a stored shape and no packet's files own the migration, that is an escalation from you, not a helper you slip into your own file. — bound: envelope:plan.systemPackets
- **Additive first; destructive alone, after nothing reads the old shape.** — why: during a rollout old and new code coexist, and one of them queries the column the other dropped. The IR cannot tell additive from destructive, but a delta that removes a node is loud: it is never auto-approved. — bound: precheck:loosening-loud
- **A change to project code lands with a test that touches it.** — why: 102 of 129 fix commits here touch a test. Advisory only, and the caveat is measured: two classes recurred despite an instance test each, and closed only when the mechanism was generalised. A test proves the instance; the mechanism is yours to fix. — bound: precheck:tests-touched
- **Never delete, skip, or silence a test to make a change pass.** — why: the safety net weakens silently unless the delta says so; a deleted test function or a skip marker added to a test file is named and never auto-approved. — bound: precheck:loosening-loud
- **When a test fails, ask whether the test is right before the code is wrong.** — why: a check written by the same packet that wrote the code is self-consistency, not conformance (trial 4 printed empty tables and passed). Judgement; no verb sees it. — bound: judgement

## What this cannot check

- The CONTENT of the migration — that it matches the schema — is a run against an old database (B), as the reviewer did; the verb sees only that the file changed.
- Whether the tests PASS: no test-run evidence class exists (G4); `tests-touched` sees that a test file changed.
- A tested down path: B, G4.
- `co-changes` reads DEMOTE in the standings and is advisory; a violation is a recorded line, never a reject, until the trigger can be a node rather than a file.

## Refused from the source

- Advisory-versus-compulsory deprecation, strangler and adapter patterns, feature-flag cutovers — reason: rollout process outside the IR; not-testable here (AS-20).
- Test-pyramid percentages, coverage thresholds — reason: numbers (brief C.8).
- The red-green-refactor cycle as a procedure — reason: what survives is the pair rule above; the cycle is process prose an oracle does not need (RUN1 4.3).
- "Remove a deprecated system after zero usage verified" — reason: `reachable` was declined; framework-dispatched functions make a dead-code verdict a likely false violation (G8).
