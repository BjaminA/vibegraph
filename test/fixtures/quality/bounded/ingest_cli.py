"""Entry point whose thread reaches a loop the DATA bounds.

`insert_rows` runs one `conn.execute` per input row. That is the cost the
perf-lever rule is about, and `not-in-loop` must report it VIOLATED even
though the same thread also runs the migration, whose loop is excluded.
Both facts appear in the one verdict: the offender is named, and so is the
loop that was not counted.
"""

from store import _conn, insert_rows, migrate_columns


def main() -> int:
    conn = _conn()
    migrate_columns(conn)
    conn.commit()
    rows = [{"device_id": "a"}, {"device_id": "b"}]
    return insert_rows(rows)


if __name__ == "__main__":
    raise SystemExit(main())
