"""External payments client — the external_http subsystem."""

import requests


def charge(amount):
    """Charge via the external payments API."""
    resp = requests.post(
        "https://api.stripe.com/v1/charges",
        json={"amount": amount},
    )
    return resp.json()
