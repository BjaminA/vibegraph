"""The one door to the database."""
import sqlite3


def connect(path):
    return sqlite3.connect(path)


def prices(conn):
    return conn.execute("SELECT name, pence FROM prices").fetchall()
