"""Helpers for app.py. `unused_helper` is named nowhere: the reachability
report's strongest dead-code reason, drawn dimmed in the code view."""


def helper(key, region):
    return f"{key}:{region}"


def unused_helper():
    return 1
