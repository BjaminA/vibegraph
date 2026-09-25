# Example 4 — Fleet telemetry (constraints the code cannot tell you)

**A four-language service big enough for thread assignment to matter,
seeded with five human-stated constraints that live nowhere in the
code** — the kind of knowledge that sits in a runbook, a post-incident
action, or a downstream team's contract:

| id | kind | what the code does NOT say |
| --- | --- | --- |
| c1 | proxy | every outbound HTTP call must leave through `telemetry/http_client.py` (egress proxy + service token) |
| c2 | payload-schema | the `/export` CSV is read **by position** by the nightly BI job — the first four columns are fixed, new ones append |
| c3 | invariant | operators are paged only via `alerts.notify` **after** `should_notify`'s 5-minute dedup |
| c4 | backend-call | the gateway never forwards `/ingest` without the caller's bearer token |
| c5 | perf-lever | readings are inserted in batches through `insert_readings`, never one row at a time |
| c6 | invariant | every production `telemetry.db` predates every schema change — a `SCHEMA` change ships with an idempotent migration in `telemetry/migrations.py` (a module that does not exist yet) |

They are stored in `.vibegraph/constraints.json` (committed on purpose)
and routed to threads by file scope: c1 and c3 reach every Python
thread, c2 reaches only the export/app/cli/gateway threads, c5 and c6
only the threads that touch `storage.py`. An agent working `codec/`
never sees them — that is the point. c6 is the one that no thread can
satisfy by itself: the migration module does not exist, so an
orchestrated run has to PROPOSE it as a system packet (M-ORCH.3).

## Shape

- `telemetry/` — Flask API (`/ingest`, `/devices`, `/export`, `/alerts`,
  `/health`), the ingest pipeline (validate → normalise → store →
  evaluate alerts), sqlite storage with an annotated connection factory,
  threshold alerts with dedup, the CSV export, an operator CLI, a batched
  backfill, unittest contracts.
- `gateway/` — TypeScript Express edge: validated + token-forwarding
  ingest, cached device view, an N+1 fleet view, CSV proxy.
- `ops/` — bash deploy (make / psql / ssh / curl-per-host) and backup
  (pg_dump / aws / rotate).
- `codec/` — C++ packet decoder with an overloaded `scale` (an honest
  `unresolved`) and gtests.

## The drill this example exists for

An under-specified task that tempts an agent to break a constraint it
cannot see in the code — e.g. "devices now report a `region`; persist
it, show it, export it, and tell operators when it changes". A naive
change inserts the column mid-CSV (breaks c2), posts the region-change
notice with `requests` directly (breaks c1), or pages without the dedup
(breaks c3). Run it two ways and score whether the constraints
survived: `reviews/h2h2/REPORT.md`.

Pinned by `npm run test:example-fleet`.
