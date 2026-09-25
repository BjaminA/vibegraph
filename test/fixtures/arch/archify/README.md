# Archify's architecture schema, vendored for tests

`architecture.schema.json` and `common.schema.json` are copied unchanged from
[tt-a1i/archify](https://github.com/tt-a1i/archify) at commit
`9e35d2b0b39b155553ba9fcfe0b4f2a5198dd993` (2026-09-23), `archify/schemas/`.
MIT License, Copyright (c) 2026 tt-a1i (Archify) and Copyright (c) 2025
Cocoon AI; the full notice, which must travel with these copies, is in
[`LICENSE`](LICENSE), copied unchanged from the same commit.

`test/arch_artifacts.test.mjs` validates `architecture.archify.json` against
them, so the adapter (`src/server/arch_archify.ts`) cannot drift from their
schema without a red test. Archify's CLI also runs LAYOUT gates (no edge
through an unrelated box, labels clear of boxes, sides honoured); the test
re-checks the one the adapter's routes exist for (no segment through an
unrelated box) with Archify's own grid formula. The full CLI gate was run by
hand on next_demo, fleet-telemetry and shop_demo: 0 errors (M-ARCH.5).

Refresh by copying the two schema files and `LICENSE` again and updating the
commit above.
