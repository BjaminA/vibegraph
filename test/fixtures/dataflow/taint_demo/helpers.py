"""Helpers the routes call."""

import os


def archive(target):
    """Tar a directory — the target arrives from the caller."""
    os.system("tar czf backup.tgz " + target)
    return "archived"
