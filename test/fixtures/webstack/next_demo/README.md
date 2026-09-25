# next_demo — the fixture the corpus lacked (an internal field brief)

Every shape a private production codebase exposed and no existing fixture carries:

| Shape | Here | Was |
|---|---|---|
| Next.js App Router route (exported HTTP verbs) | `app/api/orders/route.ts` | not discovered |
| Next.js page | `app/dashboard/page.tsx` | not discovered |
| tsconfig `paths` alias (`@/*`) | `tsconfig.json`, used by `components/`, `app/` | read as third-party |
| Node ESM module | `scripts/ingest.mjs` | not parsed at all |
| bash execing a sibling `.mjs` | `scripts/run.sh` | dead end at the doorway |
| extensionless `#!` executable | `bin/orders-cli` | invisible |
| compiled output + declarations | `build/` | parsed as source, double-counted |
| a file the parser genuinely degrades | `lib/degraded.ts` | IR emitted, damage unrecorded |
| a project funnel wrapping a tool the TABLE now knows (`@tdxvolt/*`, platform) | `lib/volt.ts` (3 importers) | not a funnel |
| a project funnel wrapping a PRIVATE SDK (stated role, or the classify pass) | `lib/ledger.ts` (2 importers) | unclassified |
| a page whose data flows through a COMPONENT tree (`<OrdersChart/>` → `refund` → the Volt client) | `app/dashboard/page.tsx` | the thread stopped at the page |
| a script whose body is its main (shebang, no `main`) | `bin/orders-cli` | no entry without a manual seed |
| a Node script with a shebang and a top-level `main()` | `scripts/backend/rollup.mjs` | not an entry |
| a browser component running a backend script THROUGH the platform, by literal path | `components/ExportButton.tsx` → `lib/volt.ts` → `scripts/backend/orders/export_orders.sh` | two dark ends |
| a script run only because another file names it (no shebang, no main) | `scripts/backend/lib/rates.mjs` | not an entry |
| a script naming a script that is not in the tree | `lib/volt.ts` (`orders/nightly_rollup.sh`) | silence |
| an MCP tool registered with an inline handler, and a client calling it by name | `mcp/server.ts` ↔ `mcp/client.ts` | not an entry; no join |
| a DEFAULT-exported component imported under another name (`export default X;`) | `components/RegionChart.tsx` | never linked |
| a script literal inside a `??` composite (the env-fallback idiom) | `lib/volt.ts` `NIGHTLY_SCRIPT` | cut by the 80-char preview |

`@acme/ledger-client` is the accounting platform's SDK: every posting leaves
through `lib/ledger.ts`, the one place a ledger entry is built.

Nothing here is a real application. Every file is the smallest thing that
carries its shape through the real pipeline.
