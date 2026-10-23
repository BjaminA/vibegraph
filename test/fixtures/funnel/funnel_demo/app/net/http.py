"""The project's one HTTP door: every request carries the same timeout."""
import json
import urllib.request
from http import HTTPStatus


def get_json(url):
    with urllib.request.urlopen(url, timeout=10) as resp:
        if resp.status != HTTPStatus.OK:
            raise RuntimeError(resp.status)
        return json.load(resp)
