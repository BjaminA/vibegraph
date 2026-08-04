"""Interprocedural hidden effect — the adversarial side-effect case.

`touched` reads pure at its own level (`size = disk_size()` has no effectKind
at the call site), so the CLIENT pre-gate ALLOWS the run. The effect lives one
frame down inside `disk_size` (`os.path.getsize`, an `fs` effect). The
authoritative SM3 server scan follows the call, sees the effect, and refuses —
surfacing the side-effect consent gate. This is the client/server divergence
the SM3 floor exists to catch.
"""

import os


def disk_size():
    return os.path.getsize("/etc/hostname")


def touched():
    """side-effect — fs effect hidden one frame down."""
    size = disk_size()
    return size
