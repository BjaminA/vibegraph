"""Calibration samples for the `guards` verb (reviews/quality-layer/RUN3.md).

CONSTRUCTED, not taken from a real tree: the h2h2 blind sample that broke
c3 lived under /tmp and was never committed (reviews/h2h2/REPORT.md, the
"blind" column), and that sample broke the MODULE half of c3, which
`callers-only` already catches. The shapes below are the ORDER half, the
thing `calls-through` admits it cannot see. Each function's name says the
verdict it expects; the real known-good is examples/fleet-telemetry's
`alerts.evaluate`, which the calibration run pairs with these.
"""

_last_sent: dict = {}


def should_notify(device: str, metric: str) -> bool:
    return (device, metric) not in _last_sent


def notify(device: str, metric: str, text: str) -> None:
    _last_sent[(device, metric)] = text


# ── known-good ────────────────────────────────────────────────────────

def good_if_arm(reading: dict) -> None:
    if should_notify(reading["device_id"], reading["metric"]):
        notify(reading["device_id"], reading["metric"], "breach")


def good_negated_return(reading: dict) -> None:
    if not should_notify(reading["device_id"], reading["metric"]):
        return
    notify(reading["device_id"], reading["metric"], "breach")


def good_bound_then_if(reading: dict) -> None:
    ok = should_notify(reading["device_id"], reading["metric"])
    if ok:
        notify(reading["device_id"], reading["metric"], "breach")


def good_negated_else(reading: dict) -> None:
    if not should_notify(reading["device_id"], reading["metric"]):
        pass
    else:
        notify(reading["device_id"], reading["metric"], "breach")


# ── known-bad ─────────────────────────────────────────────────────────

def bad_after(reading: dict) -> None:
    notify(reading["device_id"], reading["metric"], "breach")
    if should_notify(reading["device_id"], reading["metric"]):
        pass


def bad_else_arm(reading: dict) -> None:
    if should_notify(reading["device_id"], reading["metric"]):
        pass
    else:
        notify(reading["device_id"], reading["metric"], "breach")


def bad_negated_then(reading: dict) -> None:
    if not should_notify(reading["device_id"], reading["metric"]):
        notify(reading["device_id"], reading["metric"], "breach")


def bad_return_between(reading: dict) -> None:
    should_notify(reading["device_id"], reading["metric"])
    return
    notify(reading["device_id"], reading["metric"], "breach")


def bad_no_guard(reading: dict) -> None:
    notify(reading["device_id"], reading["metric"], "breach")


# ── unverifiable ──────────────────────────────────────────────────────

def unv_dynamic_target(reading: dict, sink) -> None:
    if should_notify(reading["device_id"], reading["metric"]):
        sink.notify(reading["device_id"], reading["metric"], "breach")
