"""Unit normalisation: every stored reading is in the canonical unit."""

from telemetry.metrics_math import clamp

CANONICAL_UNITS = {"temp": "c", "vibration": "g", "pressure": "kpa", "battery": "pct"}


def to_celsius(value, unit):
    """Fahrenheit or Kelvin to Celsius; Celsius passes through."""
    if unit == "f":
        return (value - 32.0) * 5.0 / 9.0
    if unit == "k":
        return value - 273.15
    return value


def to_kpa(value, unit):
    """psi or bar to kPa."""
    if unit == "psi":
        return value * 6.894757
    if unit == "bar":
        return value * 100.0
    return value


def normalize_reading(raw, received_at):
    """Return the stored shape: canonical unit, clamped battery, receipt time."""
    metric = raw["metric"]
    unit = raw.get("unit", CANONICAL_UNITS[metric])
    value = float(raw["value"])
    if metric == "temp":
        value = to_celsius(value, unit)
    elif metric == "pressure":
        value = to_kpa(value, unit)
    elif metric == "battery":
        value = clamp(value, 0.0, 100.0)
    return {
        "device_id": raw["device_id"],
        "ts": raw["ts"],
        "metric": metric,
        "value": value,
        "received_at": received_at,
    }
