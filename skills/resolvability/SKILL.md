---
name: resolvability
description: >-
  Use when a python packet changes a function signature, adds a parameter
  that is later called on, or works on a thread whose contract counts
  unattributed boundaries.
version: 1.0
last-updated: 2026-09-22
dimension: resolvability
applies_when: {"all":[{"fact":"languages","has":"python"},{"fact":"unattributedBoundaries","has":"true"}]}
binds: ["check:annotated","envelope:contract.unattributed","judgement"]
derivedFrom: ["PT-6","VG-4","VG-1"]
evidence: unvalidated
---

## Purpose

Every other check in this system sees a boundary only when the IR can
say what the receiver is. This skill is about the cheapest thing that
makes that true: an annotation on the parameter the call goes through.
No corpus skill says this; the verb was forced by what the other verbs
could not see.

## Applies when

A python thread whose contract counts unattributed boundaries. Only python
carries `paramTypes` today; on a TypeScript or C++ thread the verb answers
`unverifiable` with that reason, and this skill stays quiet.

## Rules and why

- **Annotate the parameter a boundary call goes through.** — why: `def ingest(payload):` with `payload.get(...)` reported `dynamic` is a boundary no check can reach; `def _get_conn() -> sqlite3.Connection:` is why `conn.execute` resolves to `sqlite3:Connection.execute` and lands in every section of the contract. An annotation is what turns a `dynamic` receiver into a boundary the other verbs see. `annotated` reads `paramTypes` on the entry function, or on the parameters whose receiver calls the thread reports `dynamic`. — bound: check:annotated
- **Read the contract's unattributed count as a to-do list, not a shrug.** — why: 144 unattributed boundaries fell to 43 for zero tokens once the cheapest mechanism for each was applied; the leftovers were censused and most were a missing annotation or a genuinely runtime dispatch. A pre-check watches the count after your edit and hands a rise to eyes. — bound: envelope:contract.unattributed
- **Do not annotate what you do not know.** — why: a wrong annotation passes the verb (it checks presence, not correctness) and then misleads every check downstream of it — a node in the wrong place is worse than no node. Leave it, and the contract keeps counting it honestly. — bound: judgement

## What this cannot check

- Whether the annotation is right: `annotated` checks that a type is present.
- TypeScript and C++ parameters: no `paramTypes` in those IRs yet.
- A resolution GAP (`unresolved`) is not an annotation gap: the verb counts it in its reason and does not select it. A re-link may lift it; an annotation will not.

## Refused from the source

- "Strict types, no escape hatches" as a universal — reason: `PT-6`'s outcome (fewer runtime type errors) has no local history; the mechanism is what is supported, so the rule is scoped to the receivers that matter.
- Type-coverage percentages — reason: a number (brief C.8).
