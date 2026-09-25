"""Threshold alerts with a per-(device, metric) dedup window.

Operators are paged through the webhook; the dedup in should_notify is
what keeps a flapping sensor from paging forty times a minute.
"""

import time

from telemetry.http_client import post_json

WEBHOOK_URL = "https://hooks.example.internal/fleet-alerts"
DEDUP_SECONDS = 300
THRESHOLDS = {"temp": 85.0, "vibration": 4.0, "pressure": 900.0}
BATTERY_FLOOR = 15.0

_last_sent = {}
_events = []


def should_notify(device_id: str, metric: str, now: int) -> bool:
    """True once per (device, metric) per DEDUP_SECONDS window."""
    key = (device_id, metric)
    last = _last_sent.get(key)
    if last is not None and now - last < DEDUP_SECONDS:
        return False
    _last_sent[key] = now
    return True


def notify(event: dict) -> None:
    """Page operators through the webhook and remember the event."""
    _events.append(event)
    post_json(WEBHOOK_URL, event)


def evaluate(reading: dict) -> dict | None:
    """Turn a stored reading into an alert event when it crosses a threshold."""
    metric = reading["metric"]
    value = reading["value"]
    breached = False
    if metric in THRESHOLDS and value > THRESHOLDS[metric]:
        breached = True
    if metric == "battery" and value < BATTERY_FLOOR:
        breached = True
    if not breached:
        return None
    now = int(time.time())
    if not should_notify(reading["device_id"], metric, now):
        return None
    event = {
        "device_id": reading["device_id"],
        "metric": metric,
        "value": value,
        "ts": reading["ts"],
        "sent_at": now,
    }
    notify(event)
    return event


def recent_events(limit: int) -> list:
    """Newest events first."""
    return list(reversed(_events[-limit:]))
