"""The items API the page and the Worker call."""
import json


def list_items(store):
    return json.dumps(sorted(store))


def health():
    return {"ok": True}
