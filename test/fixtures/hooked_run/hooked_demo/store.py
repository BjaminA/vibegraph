"""Storage. Only this module may purge."""


def save(value):
    """Store one value."""
    return {"saved": value}


def purge():
    """Delete everything."""
    return None
