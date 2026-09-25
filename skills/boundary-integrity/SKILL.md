---
name: boundary-integrity
description: >-
  Use when the packet's thread reaches a boundary the code leaves through —
  a db, http-client, process or remote role it calls, or an http-service
  route — and the task touches validation, authentication, a guard, or a
  dependency at that boundary.
version: 1.0
last-updated: 2026-09-22
dimension: boundary-integrity
applies_when: {"any":[{"regime":"http-service"},{"fact":"rolesCalled","has":"db"},{"fact":"rolesCalled","has":"http-client"},{"fact":"rolesCalled","has":"process"},{"fact":"rolesCalled","has":"remote"}]}
binds: ["envelope:contract.boundaries","check:guards","check:callers-only","precheck:loosening-loud","precheck:added-tools","precheck:stack-policy","judgement"]
derivedFrom: ["AS-8","AS-9","AS-33","PT-2","AS-1","AS-19","AR-6","VG-1"]
evidence: unvalidated
---

## Purpose

The places this thread leaves the project are already enumerated. This
skill says where guards belong relative to that list, which security rules
have teeth here, and which do not.

## Applies when

The thread calls a db, http-client, process or remote role, or serves an
HTTP route. A thread that never leaves the project has nothing to guard.

## Rules and why

- **Start from the contract's "Leaves the project through" section, not from the source text.** — why: it is exhaustive and attributed strongest-evidence-first, and it ended a silence: a webhook-posting thread once reported itself pure because the call carried no effect kind. A boundary the contract lists is one every check sees. — bound: envelope:contract.boundaries
- **A boundary call is governed by the guard the humans named, and the guard runs first.** — why: a reviewer read "routed through should_notify then notify", agreed, and approved code where the page bypassed the dedup. Order is what prose cannot prove. With target and guard stated, `guards` proves it (an `if` arm, or the guard before the call with no return between) and a violation rejects with the call node named. — bound: check:guards
- **Never remove a guard, a `raise`, a `return` or a validator call to make a refactor cleaner.** — why: the condition-call hole made `require_token` invisible, and a worker saw the ingest route without its authentication gate. A removed guard and an invisible one are the same danger; a delta that removes one is never auto-approved, and on a routed constraint it is that constraint's violation. — bound: precheck:loosening-loud
- **A new tool at a boundary is a decision made at the objective gate, not by you.** — why: the stack index knows what is installed and which project module funnels each tool. A first-seen third-party or unrecognised import goes to eyes; reuse the funnel, and if the task needs a tool the stack lacks, escalate — the brief proposes tools, workers do not. — bound: precheck:added-tools
- **Where a stack policy names a tool, use the one it names.** — why: `require` / `prefer` / `forbid` / `replace-with` are stated by a human with a reason, routed to the files that import the tool, and a forbidden tool in the delta rejects, naming the alternative. — bound: precheck:stack-policy
- **Who may call a boundary is a stateable fact — state it rather than describe it.** — why: `callers-only` (and `import-only` for a tool) turn "only alerts.py pages operators" into a verdict naming the offending file and call node. — bound: check:callers-only
- **Data crossing INTO the project is untrusted until validated at the boundary.** — why: the IR carries no taint and cannot see whether a value was validated before use. Direction, not a check; state the validator and boundary as a constraint and it becomes `guards`. — bound: judgement

## What this cannot check

- Which function IS a boundary and which call IS a validator, unless a human names them (AS-8 is `C` universally).
- Exception flow: a `raise` inside the guard, a `try` short-circuit, the guard's return value.
- Headers, cookies, CORS, SSRF, rate limits, password hashing, PII: outside the IR; never report them as verified.
- Secrets in a diff: a scanner run (G10); no pre-check runs one today.
- Parameterised queries: a regex over call text is a lint, not a check (RUN1 2.2).

## Refused from the source

- OWASP checklists, STRIDE, abuse cases — reason: the enumeration half is the contract; the analysis half has no IR shape.
- "Always / ask first / never" tiers, rationalisation tables, red flags — reason: scaffolding for a model that rationalises; the floor is the pre-check that names the removed node.
- Rate-limit counts, bcrypt rounds, cookie flags — reason: numbers and configuration the IR cannot observe (brief C.8).
- Ponytail's ladder as a checklist — reason: rungs 2–5 are the stack index (the dependency rule above); the rest is judgement, and size predicts churn here, not defects (AS-15).
