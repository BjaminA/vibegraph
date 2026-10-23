"""Sync releases and items with the outside world."""
import os
import shutil
import subprocess
import urllib.request

API = "https://api.example.com"
GIT = shutil.which("git") or "git"
RENDER = os.environ.get("RENDER_BIN", "pagemaker")


def list_releases(repo):
    out = subprocess.run(["gh", "api", f"repos/{repo}/releases"], capture_output=True, check=True)
    return out.stdout


def pull():
    subprocess.run([GIT, "pull", "--ff-only"], check=True)


def render(path):
    subprocess.run([RENDER, "--out", path], check=True)


def fetch_items():
    with urllib.request.urlopen(API + "/v1/items", timeout=10) as resp:
        return resp.read()


def main():
    pull()
    render("out.pdf")
    print(list_releases("acme/site"), fetch_items())


if __name__ == "__main__":
    main()
