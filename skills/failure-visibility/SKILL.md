---
name: failure-visibility
description: >-
  Use when the packet adds or changes an except / catch arm, wraps a call in
  a try, or handles an error path on a python, TypeScript or C++ thread.
version: 1.0
last-updated: 2026-09-22
dimension: failure-visibility
applies_when: {"any":[{"fact":"languages","has":"python"},{"fact":"languages","has":"jsts"},{"fact":"languages","has":"cpp"}]}
binds: ["check:handles-failure","envelope:stack.funnels","judgement"]
derivedFrom: ["AS-7","SP-6","AS-6","VG-2"]
evidence: unvalidated
---

## Purpose

A failure that is caught and dropped is invisible to every layer above the
arm that dropped it. This skill says what an arm must do so the next layer
can see the failure, and what the one check with confidence in this area
can and cannot tell.

## Applies when

The thread is python, TypeScript or C++. Bash is excluded on purpose: its
stack index carries no `log` role, so the verb answers `unverifiable` there
rather than `pass`, and a skill that told a bash worker its arms were
checked would be lying.

## Rules and why

- **Every `except` / `catch` arm re-raises, returns, or reaches a log call.** — why: the silence class is the most frequent honesty fix in this repository's history — an external with no effect kind that appeared in no section, an edge the panel could not draw and said nothing about. An arm that swallows is that class in the user's code. `handles-failure` checks each arm the thread reaches for a `raise`, a `return`, or a call attributed to the `log` role or a project funnel that wraps one. — bound: check:handles-failure
- **The only swallow the IR names with confidence is the EMPTY arm with a BROAD type.** — why: calibration on this repository's own code found nineteen fires on presumed-good arms, most of them `except X: continue` in loops, and the review narrowed the verb: a named expected exception is handled by declaration. So a bare `except Exception: pass` is a finding; `except (OSError, ValueError): continue` says what it skips. Name the type you expect. — bound: check:handles-failure
- **Log through the project's log funnel, not a fresh logger.** — why: attribution reaches a call through the `log` role or a funnel that wraps it; `self.logger.error(e)` on a receiver the IR cannot resolve is `unverifiable`, runtime dispatch named, and the arm looks unchecked. The stack index lists the funnels. — bound: envelope:stack.funnels
- **A deliberate swallow is a stated decision, not a comment.** — why: the tracer's `except Exception: pass  # a tracer must never break the run` is intended and the IR cannot read the comment; today it is a finding the reviewer re-reads every run. Until node-scoped allowances exist (gap G13), state the allowance as a constraint on that node with the reason, or escalate — do not hide it in a narrower type it does not mean. — bound: judgement

## What this cannot check

- Re-raise semantics: a bare `raise` versus a new exception that drops the cause.
- Whether the log call runs before the return, and whether its level is an error.
- `pass` versus `continue`: the IR cannot tell them apart; both are empty arms.
- Which `raise` reaches which `except` (G11).
- Bash arms, and any language whose stack index has no `log` role: `unverifiable`, never a pass.

## Refused from the source

- Structured-log field rules, correlation ids, cardinality bounds, alert severities, runbooks — reason: outside the IR; a worker cannot be told these are checked here.
- "error / warn / info / debug" level semantics as a rule — reason: the level is not visible to the verb; only that a log call exists.
- "Add logging after it works" rationalisation table — reason: scaffolding (RUN1 4.3).
