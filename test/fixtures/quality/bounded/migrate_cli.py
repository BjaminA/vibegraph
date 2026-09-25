"""Entry point whose thread reaches ONLY source-bounded loops.

Every `conn.execute` this thread can reach sits inside a loop whose length
the source fixes, so `not-in-loop` must PASS here — and must say which loops
it did not count and why, because a checker that quietly drops what it could
not judge is worse than the prose it replaced.
"""

from store import _conn, drop_indexes, migrate_columns, set_pragmas


def main() -> int:
    conn = _conn()
    set_pragmas(conn)
    migrate_columns(conn)
    drop_indexes(conn)
    conn.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
