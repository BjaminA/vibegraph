from pathlib import Path


def host_of(name):
    """Same name as report.host_of, but this one touches the file system."""
    return Path.cwd() / name


def is_primary(name):
    return Path.cwd().name == name
