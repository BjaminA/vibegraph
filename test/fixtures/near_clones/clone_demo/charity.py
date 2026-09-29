"""Two copy-paste siblings (a fix to one applies to the other) and a function that only looks busy."""

import json
import logging

import requests

log = logging.getLogger(__name__)


def fetch_details(charity_id, api_key):
    url = build_url("details", charity_id)
    headers = auth_headers(api_key)
    response = requests.get(url, headers=headers, timeout=10)
    response.raise_for_status()
    payload = json.loads(response.text)
    log.info("fetched %s", charity_id)
    return normalise(payload)


def fetch_overview(charity_id, api_key):
    url = build_url("overview", charity_id)
    headers = auth_headers(api_key)
    response = requests.get(url, headers=headers, timeout=10)
    response.raise_for_status()
    payload = json.loads(response.text)
    log.info("fetched %s", charity_id)
    return normalise(payload)


def register_all(server):
    server.register("a")
    server.register("b")
    server.register("c")
    server.register("d")
    server.register("e")
    server.register("f")


def build_url(kind, charity_id):
    return "https://example.invalid/%s/%s" % (kind, charity_id)


def auth_headers(api_key):
    return {"Authorization": "Bearer " + api_key}


def normalise(payload):
    return {k.lower(): v for k, v in payload.items()}
