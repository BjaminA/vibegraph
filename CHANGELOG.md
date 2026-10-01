# Changelog

`vibegraph-knowledge` and the VibeGraph app. Newest first. Each entry says what
changed and, where an existing user would notice, how behaviour differs.

## 0.17.0 — unreleased

### The planned architecture on the map (brief Module 1)

- **Planned threads on their process.** A planned process card on the
  architecture map carries an **N threads** chip; it opens the threads that
  name the process (`process` on a plan thread) as dashed step chains,
  coloured by their plan-check verdict, with a step plan check did not find
  struck through. Plan check now reports a drifted thread's missing steps as
  data (`missing`) and a realised process's entry points (`entryPoints`).
- **Rules and open questions where they belong.** Plan rules and open
  questions take an optional `about` (a planned process, thread, boundary or
  tool id, validated); they show as **N rules** / **N open** chips on that
  item. A rule without `about` lands on the one process whose files it names;
  anything else is listed under the Real / Plan / Overlay switch.
- **Boundary keys.** A planned boundary's edge reads `protocol · N keys`, the
  keys on hover.
- **Trust zones.** A planned boundary whose ends sit in two different stated
  (or proposed) trust / zone groups is drawn in the warning colour, the
  crossing named on hover.
- **Seed groups from the plan.** `architecture --seed-plan [--force]` and the
  **Seed groups** button propose `.vibegraph/architecture.json` groups read off
  the plan — a process group per realised planned process, and project /
  outside trust zones — with no model and no tokens. Pending until ratified,
  gated like a model's proposal.

**Behaviour change for existing users.** In the **Overlay**, a planned item the
code has realised used to be hidden on the assumption that its real box stood
for it — but nothing marked which box, and an item the real map draws no box
for (a web framework, a library with no entry point) was drawn nowhere, along
with its threads and rules. Now a realised item marks its real box with a
**planned ✓** chip and moves its threads and rules there; one with no real box
is its own card, chipped the same. The Overlay can therefore show one more card
than before (the plan_demo fixture: 3 → 4, the realised `flask`). Plans that
use none of the new fields (`about`) are read exactly as before; a plan whose
`about` names nothing is refused with the reason, like any other invalid plan.

Tests: test:plan-map (6, fixture `test/fixtures/plan/map_demo`),
test:e2e-plan-map (2), test:e2e-plan (updated: the Overlay's fourth card).

## 0.16.0 — 2026-10-01

- `init --hooks --windows`: hooks a Windows-side Claude Code runs against a
  WSL project. `handles-failure` reads TypeScript / JavaScript. `this.field.method()`
  links when the class names the field's type. Plan check matches a step
  written `Class.method`. A `files`-scoped check reads the files its rule
  names. Sibling container chips no longer overlap.
