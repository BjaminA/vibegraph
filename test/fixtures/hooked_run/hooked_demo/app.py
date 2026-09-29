"""The app: records go through store.save."""

from store import save


def create(name):
    """Create a record."""
    return save(name)


def rename(old, new):
    """Rename a record."""
    return save(new)
