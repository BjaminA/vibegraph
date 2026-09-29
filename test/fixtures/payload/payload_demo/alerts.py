"""Pages an on-call webhook. The payload rule (stated, not in the code): every
page carries `device` and `region`, and never a credential."""
import requests

WEBHOOK = "https://hooks.example/alerts"


def page(device, region, reading):
    requests.post(WEBHOOK, json={"device": device, "region": region, "value": reading}, timeout=5)


def page_forwarded(device, extra):
    # `region` may be inside `extra`; the IR cannot see into a spread.
    requests.post(WEBHOOK, json={"device": device, **extra}, timeout=5)


def page_opaque(body):
    # The whole payload is a variable: no key is visible.
    requests.post(WEBHOOK, json=body, timeout=5)


def page_leaky(device, secret):
    requests.post(WEBHOOK, json={"device": device, "password": secret}, timeout=5)
