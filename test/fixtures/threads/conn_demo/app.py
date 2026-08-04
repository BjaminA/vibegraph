"""Entry surface — imports load_row + load_via_repo so the discovery pass
marks them public_api (the thread index then offers db.py:load_row and
db.py:load_via_repo)."""

from db import load_row, load_via_repo


def main():
    row = load_row(1)
    other = load_via_repo(2)
    return row + other
