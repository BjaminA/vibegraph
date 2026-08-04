"""SQLite-backed user store — the db subsystem."""

import sqlite3


def _conn():
    return sqlite3.connect("system_demo.db")


def all_users():
    """Return every user row."""
    conn = _conn()
    cursor = conn.execute("SELECT id, name FROM users")
    return cursor.fetchall()


def find_user(uid):
    """Return one user row by id."""
    conn = _conn()
    cursor = conn.execute("SELECT id, name FROM users WHERE id = ?", (uid,))
    return cursor.fetchone()
