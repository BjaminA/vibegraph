"""Bearer-token check for the ingest route."""

import os

INGEST_TOKENS = set(filter(None, os.environ.get("FLEET_INGEST_TOKENS", "gateway-dev-token").split(",")))


def bearer_token(req) -> str | None:
    """The bearer token from the Authorization header, or None."""
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return header[len("Bearer "):].strip() or None


def require_token(req) -> bool:
    """True when the request carries a known ingest token."""
    token = bearer_token(req)
    return token is not None and token in INGEST_TOKENS
