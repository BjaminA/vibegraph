"""Dependency-free arithmetic helpers."""


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def rolling_mean(values: list) -> float:
    if not values:
        raise ValueError("rolling_mean requires at least one value")
    return sum(values) / len(values)


def zscore(value: float, values: list) -> float:
    """How many standard deviations `value` sits from `values`' mean."""
    mean = rolling_mean(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    std = variance ** 0.5
    if std == 0.0:
        return 0.0
    return (value - mean) / std
