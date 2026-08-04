"""A data-access helper exercising §5.5 one-hop return-type inference.

`load_row` is imported by app.py, so the discovery pass surfaces it as a
public_api entry point. Its `conn` receiver is bound from `_get_conn`,
which carries an explicit `-> sqlite3.Connection` return annotation — so
§5.5 resolves `conn.execute` to honest-external `sqlite3.Connection.execute`
instead of the honest-but-coarse `dynamic` an UNannotated factory yields
(the flask_demo `_get_conn` case, deliberately left unannotated so
r4-conn-honesty keeps asserting dynamic).

`load_via_repo` exercises the CROSS-FILE variant: its factory `get_conn`
is imported from `repo.py`, and §5.5's project-wide return-type map
resolves its annotation across the file boundary.
"""

import sqlite3

from repo import get_conn


def _get_conn() -> sqlite3.Connection:
    return sqlite3.connect("app.db")


def load_row(row_id):
    conn = _get_conn()
    conn.execute("INSERT INTO t VALUES (?)", (row_id,))
    return row_id


def load_via_repo(row_id):
    conn = get_conn()
    conn.execute("INSERT INTO t VALUES (?)", (row_id,))
    return row_id
