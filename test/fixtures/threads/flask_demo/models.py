"""Domain models + CRUD helpers.

`User`, `find_user`, `list_users`, and `create_user` are imported from
both app.py and cli.py — public_api kind. The class is dataclass-style
to confirm class decorators round-trip through the parser at IR 1.2.
"""

from dataclasses import dataclass

from db import query, insert


@dataclass
class User:
    uid: int
    name: str
    email: str


def find_user(uid):
    rows = query("SELECT uid, name, email FROM users WHERE uid = ?", (uid,))
    if not rows:
        return None
    row = rows[0]
    return User(uid=row[0], name=row[1], email=row[2])


def list_users():
    rows = query("SELECT uid, name, email FROM users ORDER BY uid", ())
    return [User(uid=r[0], name=r[1], email=r[2]) for r in rows]


def create_user(name, email):
    uid = insert("INSERT INTO users (name, email) VALUES (?, ?)", (name, email))
    return User(uid=uid, name=name, email=email)
