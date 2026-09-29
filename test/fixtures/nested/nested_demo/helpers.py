"""Nested helpers in Python: one called in a loop, and one that shadows a module function."""

import requests


def outer(ids):
    def load(i):
        return requests.get("https://example.invalid/%d" % i)

    for i in ids:
        load(i)


def shadow():
    return 1


def uses_shadow():
    def shadow():
        return requests.post("https://example.invalid")

    shadow()


def takes_callable(load):
    load(1)
