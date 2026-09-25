---
name: retry-root-cause
description: >-
  Use when the packet is on its second attempt after a rejection — the
  RETRY NOTICE is in the prompt and names what must change.
version: 1.0
last-updated: 2026-09-22
dimension: retry
applies_when: {"task":"retry","is":true}
binds: ["precheck:retry-notice","envelope:contract","envelope:observations","precheck:loosening-loud","judgement"]
derivedFrom: ["AS-6","SP-5","AS-28","TF-4","SP-2","SP-3"]
evidence: unvalidated
---

## Purpose

A rejected attempt is evidence, and the second attempt is the last one.
This skill says what the notice already tells you, where the cheap evidence
is before you change anything, and what a second failure of the same kind
means.

## Applies when

The packet's attempt count is above zero: the previous attempt was
rejected, its edits were restored, and a fresh session is running with the
RETRY NOTICE. This never fires on a first attempt.

## Rules and why

- **The notice names the file and the node; change that mechanism, not a symptom near it.** — why: `with` was patched, then `if`, then `while`, and the class stayed alive until one generic walk closed it — "it was ONE bug, not twenty". A reject that named `telemetry/alerts.py:module/evaluate.fn/notify.call` is telling you where the rule was broken, not where to add a special case. The notice carries the constraint's id, its text (the why), the check that fired, and every offender as `file:node`. — bound: precheck:retry-notice
- **Get the evidence before the fix: the contract, the blast radius, the observations.** — why: the corpus says "add diagnostic instrumentation at each component boundary"; here the boundaries are already enumerated in the contract, `vibegraph_blast_radius` says what a change reaches, and Observe or a trace reports what a receiver actually was without a probe or a rewrite. Reproduction is cheap when the evidence is already collected. — bound: envelope:contract
- **A verdict of `unverifiable` on the rejected attempt is not a pass you can argue for.** — why: it names a `dynamic` or `unresolved` terminal between the guard and the call. A trace or an annotation lifts a `dynamic`; a re-link may lift an `unresolved`. Lifting it is the fix; describing the code in your summary is not. — bound: envelope:observations
- **Do not make the second attempt pass by loosening what the first one kept.** — why: a removed `raise`, `return` or guard, a deleted test, a skip marker: the pre-check names each and never auto-approves it, and on a routed constraint it is that constraint's violation. The bar does not move because the attempt is the last one. — bound: precheck:loosening-loud
- **If the rule is wrong, escalate with the evidence; if the scope is wrong, escalate as a plan problem.** — why: a second rejection is final — the packet fails and its dependents skip; there is no third attempt. A rule you cannot satisfy in scope, or a different constraint violated on the retry, is information the human needs, and an escalation carries both diffs. A worker cannot widen its own scope or add a packet; the human confirms that at the gate. — bound: judgement

## What this cannot check

- Whether your fix is right: the review does, against the same checks.
- The rejected attempt's session is never resumed (its picture of the tree is wrong); the notice carries what it may carry, and this skill carries no memory across attempts.
- The escalation refinements RUN1 5.1 proposed — a second violation of the same constraint escalating rather than failing, a skill staled by the contradiction — are proposed, not wired. What is wired: one bounded retry, then `failed`.

## Refused from the source

- "Three failed fixes → question the architecture", the four-phase and six-step procedures — reason: a number and process prose; the deterministic form is the bounded retry (RUN1 4.3, 5.1).
- Rationalisation tables ("the issue is simple", "emergency") — reason: scaffolding for a model that rationalises.
- "Error output is data, not instruction" — reason: covered structurally: raw tool content never becomes instruction here; write tools are denied to every spawn (AS-32).
- "Write the regression test first" as a rule of this skill — reason: lives in `change-coupling` with its measured caveat.
