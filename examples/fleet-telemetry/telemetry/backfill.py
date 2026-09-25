"""Backfill readings from an export file (a past outage, a migrated site)."""

import time

from telemetry.export import parse_export
from telemetry.normalize import normalize_reading
from telemetry.schema import validate_reading
from telemetry.storage import insert_readings

BATCH_SIZE = 500


def backfill_from_file(path: str) -> int:
    """Re-ingest an export CSV in insert batches; returns rows stored."""
    with open(path, newline="") as handle:
        rows = parse_export(handle.read())
    received_at = int(time.time())
    stored = 0
    batch = []
    for row in rows:
        raw = {"device_id": row["device_id"], "ts": int(row["ts"]), "metric": row["metric"], "value": float(row["value"])}
        if validate_reading(raw):
            continue
        batch.append(normalize_reading(raw, received_at))
        if len(batch) == BATCH_SIZE:
            stored += insert_readings(batch)
            batch = []
    if batch:
        stored += insert_readings(batch)
    return stored
