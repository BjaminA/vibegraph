"""The ONE outbound HTTP path for the Python service.

Every request leaves through the egress proxy with the service token
attached. Nothing in this codebase says why — the reason lives with the
operators (see .vibegraph/constraints.json), not in the code.
"""

import os

import requests

EGRESS_PROXY = os.environ.get("FLEET_EGRESS_PROXY", "http://egress.internal:3128")
SERVICE_TOKEN = os.environ.get("FLEET_SERVICE_TOKEN", "dev-token")
TIMEOUT_SECONDS = 5


def _session():
    session = requests.Session()
    session.proxies.update({"http": EGRESS_PROXY, "https": EGRESS_PROXY})
    session.headers.update({"authorization": f"Bearer {SERVICE_TOKEN}"})
    return session


def post_json(url: str, body: dict) -> dict:
    """POST a JSON body through the egress proxy; returns the decoded reply."""
    response = _session().post(url, json=body, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json() if response.content else {}


def get_json(url: str) -> dict:
    """GET JSON through the egress proxy."""
    response = _session().get(url, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()
