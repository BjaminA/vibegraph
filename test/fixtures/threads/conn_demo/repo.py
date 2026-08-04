"""A separate module holding the annotated connection factory — exercises
§5.5 CROSS-FILE one-hop return-type inference. `db.py` imports `get_conn`
from here; the linker's project-wide return-type map resolves its
`-> sqlite3.Connection` annotation so `conn.execute` in db.py's caller
paints honest-external, even though the factory lives in another file.
"""

import sqlite3


def get_conn() -> sqlite3.Connection:
    return sqlite3.connect("app.db")
