import sqlite3


def save(row):
    conn = sqlite3.connect("demo.db")
    conn.execute("insert into rows values (?)", (row,))
    conn.commit()


def slug(text):
    return text.lower()
