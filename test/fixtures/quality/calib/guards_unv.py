"""The `guards` verb's UNVERIFIABLE sample, in its own file so the verdict
is not drowned by guards_demo.py's violations (a violation is a fact and
wins; this file has none). Checked with --files guards_unv.py.

`sink.notify(...)` is a call on a parameter: the thread reports it
`dynamic`, its tail spells the target, and the IR cannot say whether it
IS notify. The family rule (RUN1.md section 3) makes that `unverifiable`
with cause `dynamic`, which only a trace or a stated attribution lifts.
"""

from guards_demo import should_notify


def unv_dynamic_target(reading: dict, sink) -> None:
    if should_notify(reading["device_id"], reading["metric"]):
        sink.notify(reading["device_id"], reading["metric"], "breach")
