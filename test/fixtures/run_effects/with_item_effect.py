"""PLAN-v7 6a fixture: with-item effects the floor previously missed.

Before 6a, `with open(...) as f:` emitted NO node at all (parse_cst had no
With visitor), so scan_effects judged these paths PURE while they touched
the filesystem. Both with-item forms are pinned here:
  * as-bound   -> assignment node (name=f, callTarget=open, effectKind=fs)
  * bare       -> call node (funcName=open, effectKind=fs)
Plus the sqlite shape (6a classifier addition): `with sqlite3.connect(...)
as conn:` must carry effectKind=db — opening a connection creates the db
file on disk.
"""
import sqlite3


def init_db(path):
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE t (x INTEGER)")
    return path


def read_config(path):
    with open(path) as f:
        data = f.read()
    total = len(data)
    return total


def append_log(msg):
    with open("log.txt", "a"):
        pass
    return msg


def pure_len(items):
    doubled = [x * 2 for x in items]
    return len(doubled)
