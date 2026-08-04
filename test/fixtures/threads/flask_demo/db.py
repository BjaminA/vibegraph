"""Tiny SQLite wrapper.

Both `query` and `insert` are imported by models.py — they form the
public-api surface of this module. `_get_conn` is module-private
convention (leading underscore + no cross-file imports), so it must
NOT be detected as public_api by the M8.2 discovery pass.
"""

import sqlite3

DB_PATH = "flask_demo.sqlite"


def _get_conn():
    return sqlite3.connect(DB_PATH)


def query(sql, params=()):
    conn = _get_conn()
    try:
        cursor = conn.execute(sql, params)
        return cursor.fetchall()
    finally:
        conn.close()


def insert(sql, params):
    conn = _get_conn()
    try:
        cursor = conn.execute(sql, params)
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()
