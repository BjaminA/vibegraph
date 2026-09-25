"""The shapes `not-in-loop` must tell apart: a loop the SOURCE bounds, and a
loop the DATA bounds.

CONSTRUCTED, and built because the corpus lacks the shape. The census across
every fixture and example (h2h3, 2026-09-21) found 28 for-loops — 14 over a
variable, 6 over a call result, 4 over a module constant, 2 over an inline
literal — and NOT ONE of the six source-bounded ones carries an effectful
call. Nothing already committed could have caught the narrowing going wrong,
which is the same gap `test/fixtures/stack/stdlib_demo` was built for in
M-TABLES and `comp_demo` in M-COMP.

Why the narrowing was necessary: in head-to-head #3 all five plain-Claude
arms AND the orchestrated run wrote a schema migration that loops over a
module constant of one or two columns and runs `conn.execute` per entry, and
the `not-in-loop` clause on fleet c5 — a rule whose story is an eleven-hour
2M-row backfill — reported every one of them violated. A loop over a
collection the source writes out runs a fixed number of times however much
data arrives. It is not the per-row cost the rule forbids.

The distinction is read from the IR, never guessed: an iterable that IS a
literal collection, or a bare upper-case name a module-level assignment
binds to one. A constant bound to a CALL does not qualify, because the
source does not say how many.
"""

import sqlite3

DB = "bounded_demo.db"

# Fixed by the source: one entry, written here. The h2h3 migration shape.
ADDED_COLUMNS = (("readings", "region", "text"),)

# Also fixed by the source, spelled as a list.
INDEXES = ["idx_device", "idx_ts"]


def _conn() -> sqlite3.Connection:
    return sqlite3.connect(DB)


def migrate_columns(conn: sqlite3.Connection) -> None:
    """One execute per COLUMN. Always one, whatever the data."""
    for table, column, column_type in ADDED_COLUMNS:
        conn.execute(f"alter table {table} add column {column} {column_type}")


def drop_indexes(conn: sqlite3.Connection) -> None:
    """A module constant bound to a literal list. Always two."""
    for name in INDEXES:
        conn.execute(f"drop index if exists {name}")


def set_pragmas(conn: sqlite3.Connection) -> None:
    """The iterable IS the literal. There is no name to look up."""
    for pragma in ["journal_mode=WAL", "synchronous=NORMAL"]:
        conn.execute(f"pragma {pragma}")


def insert_rows(rows: list) -> int:
    """The real defect the rule is about: one round trip per input row."""
    conn = _conn()
    for row in rows:
        conn.execute("insert into readings (device_id) values (?)", (row["device_id"],))
    conn.commit()
    return len(rows)
