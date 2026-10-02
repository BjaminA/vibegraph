"""A fake repository: counted, never walked as production code."""
from catalog import CatalogRepo, register


class FakeRepo(CatalogRepo):
    def __init__(self):
        self.saved = {}

    def save(self, name, meta):
        self.saved[name] = meta

    def get(self, name):
        return self.saved.get(name, {})


def test_register():
    register("a", {}, FakeRepo(), None)
