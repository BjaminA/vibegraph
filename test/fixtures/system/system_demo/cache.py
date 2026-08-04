"""Module-level cache facade — the cache subsystem.

Classified as `cache` by the aggregator's name-match heuristic (the
`cache` identifier in the call target), not by a per-file effectKind.
"""


class _Cache:
    def __init__(self):
        self._store = {}

    def get(self, key):
        return self._store.get(key)

    def set(self, key, value):
        self._store[key] = value


cache = _Cache()
