"""Authority fixture: a pure-LOOKING helper that hides a side effect.

`main` reads as pure at its own level — `file_size()` is a plain local
call with no effectKind at the call site. The effect lives one frame down,
inside the helper (`os.path.getsize`, an `fs` effect). Crucially the
effect is a resolved EXTERNAL call, not a dynamic one — so it produces no
dynamic/unresolved thread terminal for the client to notice. The client
pre-gate (runToNode.ts) only scans main's own body for effectKind, so it
ALLOWS running to `total`. The authoritative server scan (scan_effects.py)
follows the call into file_size, sees the `fs` effect, and REFUSES. That
gap — interprocedural effectKind — is the whole point of the SM3 floor.
"""

import os


def file_size():
    size = os.path.getsize("/etc/hostname")
    return size


def main():
    n = file_size()
    total = n + 1
    return total
