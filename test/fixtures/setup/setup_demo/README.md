# setup demo

A small ledger recorder (the `setup` fixture, PLAN 2026-10-20).

Entries are posted through @acme/ledger-client, the ledger team's own SDK — its docs: https://ledger.example.com/docs/client

Settled entries are mirrored to Firestore (Firebase docs: https://firebase.google.com/docs/firestore).

Recent entries are cached in [Upstash Redis](https://upstash.com/redis) between requests.

`ops/sync.sh` runs the in-house `ledgerctl` command.
