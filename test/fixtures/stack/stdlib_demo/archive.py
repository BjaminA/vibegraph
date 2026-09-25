"""Archive readings and ship them on.

M-TABLES fixture. Every stdlib import here was reported as a THIRD-PARTY
DEPENDENCY before the tables were generated: `tarfile`, `zoneinfo` and
`sysconfig` are standard, and none of them was in the hand-written list of
87. `requests` is beside them on purpose — it is a real dependency, and the
two must not read the same.
"""

import sysconfig
import tarfile
import zoneinfo
from datetime import datetime

import requests


def archive(readings_dir: str, bundle: str) -> str:
    """Bundle a directory of readings and say where the interpreter lives."""
    with tarfile.open(bundle, "w:gz") as tar:
        tar.add(readings_dir)
    return sysconfig.get_path("purelib")


def stamp(when: datetime) -> datetime:
    """Attach the deployment's timezone to a naive timestamp."""
    return when.replace(tzinfo=zoneinfo.ZoneInfo("Europe/London"))


def publish(bundle: str, url: str):
    """Send the bundle on. This one really is a third-party dependency."""
    with open(bundle, "rb") as handle:
        return requests.post(url, files={"bundle": handle}, timeout=30)
