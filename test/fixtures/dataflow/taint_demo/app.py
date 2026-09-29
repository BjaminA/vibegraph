"""A small Flask app with every shape the untrusted-input pass must tell apart."""

import os
import sqlite3
import subprocess

from flask import Flask, request

from helpers import archive

app = Flask(__name__)
ALLOWED = {"daily", "weekly"}


@app.route("/ping")
def ping_route():
    """UNGUARDED command: a query parameter straight into a shell string."""
    host = request.args.get("host")
    os.system(f"ping -c 1 {host}")
    return "ok"


@app.route("/users/search")
def search_route():
    """UNGUARDED SQL: the name is formatted into the query text."""
    name = request.args.get("name")
    conn = sqlite3.connect("app.db")
    rows = conn.execute(f"SELECT * FROM users WHERE name = '{name}'").fetchall()
    return {"rows": rows}


@app.route("/users/find")
def find_route():
    """SAFE SQL: the name is a separate parameter, not query text."""
    name = request.args.get("name")
    conn = sqlite3.connect("app.db")
    rows = conn.execute("SELECT * FROM users WHERE name = ?", (name,)).fetchall()
    return {"rows": rows}


@app.route("/users/<uid>")
def user_route(uid):
    """SAFE: converted to an int before it reaches the query text."""
    num = int(uid)
    conn = sqlite3.connect("app.db")
    return {"row": conn.execute(f"SELECT * FROM users WHERE uid = {num}").fetchone()}


@app.route("/report")
def report_route():
    """GUARDED: an allow-list check on the way — reported for review."""
    kind = request.args.get("kind")
    if kind not in ALLOWED:
        return "bad kind", 400
    os.system(f"make-report {kind}")
    return "ok"


@app.route("/archive", methods=["POST"])
def archive_route():
    """ACROSS A CALL: the path reaches a shell string inside helpers.archive."""
    path = request.json["path"]
    return archive(path)


@app.route("/list")
def list_route():
    """ARGUMENT-LEVEL: a list-form subprocess — no shell, still an argument."""
    folder = request.args.get("folder")
    return subprocess.run(["ls", folder], capture_output=True).stdout


@app.route("/health")
def health_route():
    """NO INPUT: nothing untrusted reaches this command."""
    os.system("uptime")
    return "ok"
