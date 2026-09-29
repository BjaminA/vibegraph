"""Calibration samples for the `payload-keys` verb (scripts/quality_calibrate.mjs).

Rule under test: every requests.post carries json.region and never json.password.
good_* comply, bad_* break it where the keys are visible, unv_* hide the
keys (a variable, a dict() call, a spread, **kwargs) and must read
unverifiable — never a violation.
"""

import requests

URL = "https://example.invalid/hook"


def good_literal(device, region):
    requests.post(URL, json={"device": device, "region": region})


def good_extra_keys(device, region):
    requests.post(URL, json={"device": device, "region": region, "value": 1}, timeout=5)


def unv_variable(body):
    requests.post(URL, json=body)


def unv_dict_call(region):
    requests.post(URL, json=dict(region=region))


def unv_spread(base):
    requests.post(URL, json={**base, "device": 1})


def unv_kwargs(options):
    requests.post(URL, **options)


def bad_missing(device):
    requests.post(URL, json={"device": device})


def bad_forbidden(device, region, secret):
    requests.post(URL, json={"device": device, "region": region, "password": secret})
