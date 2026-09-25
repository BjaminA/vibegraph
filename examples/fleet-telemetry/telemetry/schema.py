"""Payload contract for POST /ingest.

A batch is {"readings": [reading, ...]}; a reading is
{"device_id": str, "ts": int, "metric": str, "value": number, "unit": str?}.
"""

REQUIRED = ("device_id", "ts", "metric", "value")
KNOWN_METRICS = ("temp", "vibration", "pressure", "battery")
MAX_BATCH = 500


def validate_batch(payload) -> list:
    """Batch-level problems: shape, size."""
    problems = []
    if not isinstance(payload, dict) or not isinstance(payload.get("readings"), list):
        problems.append("payload must be {readings: [...]}")
        return problems
    if len(payload["readings"]) == 0:
        problems.append("readings must not be empty")
    if len(payload["readings"]) > MAX_BATCH:
        problems.append(f"readings must have at most {MAX_BATCH} items")
    return problems


def validate_reading(raw) -> list:
    """Reading-level problems: required keys, metric name, value type."""
    problems = []
    if not isinstance(raw, dict):
        return ["reading must be an object"]
    for key in REQUIRED:
        if key not in raw:
            problems.append(f"missing {key}")
    if problems:
        return problems
    if raw["metric"] not in KNOWN_METRICS:
        problems.append(f"unknown metric {raw['metric']}")
    if not isinstance(raw["value"], (int, float)) or isinstance(raw["value"], bool):
        problems.append("value must be a number")
    if not isinstance(raw["ts"], int):
        problems.append("ts must be epoch seconds")
    return problems
