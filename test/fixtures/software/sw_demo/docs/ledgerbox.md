# LedgerBox

LedgerBox is a replicated key-value ledger that keeps every write as an immutable entry.
It ships as the `ledgerbox` Python package.

## Operations

Use put_blob to store a binary payload under a key. get_blob returns the payload for a key.
Always call wait_ready before calling get_blob; a blob is readable only once it is READY.
Blob states are DRAFT, ANNOUNCED and READY.

Empty payloads are never written to the store.

append_entry writes an entry to the ledger. Entries cannot be edited once written.

## Permissions

Clients need the ledger:read permission to read and ledger:write to write.
