"""Device registry and summaries."""

import time

from telemetry.metrics_math import rolling_mean
from telemetry.storage import latest_for_device, list_devices, readings_between, upsert_device


def register_device(device_id: str, label: str | None = None) -> None:
    """Register on first sight; refresh the label later."""
    upsert_device(device_id, label, int(time.time()))


def list_device_ids() -> list:
    return list_devices()


def device_summary(device_id: str) -> dict | None:
    """Latest value per metric plus a one-hour rolling mean for temp."""
    latest = latest_for_device(device_id)
    if not latest:
        return None
    hour_ago = int(time.time()) - 3600
    temps = [r["value"] for r in readings_between(hour_ago, None) if r["device_id"] == device_id and r["metric"] == "temp"]
    return {
        "device_id": device_id,
        "latest": latest,
        "temp_hour_mean": rolling_mean(temps) if temps else None,
    }
