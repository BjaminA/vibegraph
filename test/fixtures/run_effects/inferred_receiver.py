"""§5.5 floor-safety gap — a NON-conventional receiver name bound from an
annotated factory.

`c.execute(...)` resolves (post-§5.5) to honest-external
`sqlite3.Connection.execute` via `_get_conn`'s return annotation. But the
parse-time effectKind heuristic is receiver-NAME based — `conn`/`db`/etc.
are db, a bare `c` is not — so this call carries NO effectKind. Without
the §5.5 floor marker the server scan would see a plain viaLocal-external
boundary and ALLOW running through it: a silent db write. The
viaReturnType marker makes the floor refuse conservatively.

The factory body is deliberately effect-INVISIBLE (a pool lookup, not
`sqlite3.connect(...)` — 6a classifies that as a db effect, which would
refuse one step earlier and mask the viaReturnType mechanism this
fixture exists to pin).
"""
import sqlite3

_POOL: dict = {}


def _get_conn() -> sqlite3.Connection:
    return _POOL["main"]


def main(row_id):
    c = _get_conn()
    c.execute("INSERT INTO t VALUES (?)", (row_id,))
    total = row_id + 1
    return total
