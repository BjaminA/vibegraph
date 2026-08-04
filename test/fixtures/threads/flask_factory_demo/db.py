"""Tiny DB layer so factory-route threads have cross-file depth."""
import sqlite3


def _get_conn() -> sqlite3.Connection:
    return sqlite3.connect("demo.db")


def query(sql):
    conn = _get_conn()
    try:
        cursor = conn.execute(sql)
        return cursor.fetchall()
    finally:
        conn.close()
