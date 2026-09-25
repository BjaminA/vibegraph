"""Ingest pipeline: validate → normalise → store → evaluate alerts.

One batch in, one result out. Every reading that fails validation is
reported by index; the valid remainder is stored and evaluated.
"""

import time

from telemetry.alerts import evaluate
from telemetry.normalize import normalize_reading
from telemetry.schema import validate_batch, validate_reading
from telemetry.storage import insert_readings


def ingest_batch(payload):
    """Validate, normalise, store, and alert on one batch of readings."""
    batch_errors = validate_batch(payload)
    if batch_errors:
        return {"accepted": 0, "errors": batch_errors}
    accepted = []
    errors = []
    for index, raw in enumerate(payload["readings"]):
        problems = validate_reading(raw)
        if problems:
            errors.append({"index": index, "problems": problems})
            continue
        accepted.append(normalize_reading(raw, received_at=int(time.time())))
    if accepted:
        insert_readings(accepted)
        for reading in accepted:
            evaluate(reading)
    return {"accepted": len(accepted), "errors": errors}
