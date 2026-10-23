"""Run programs through one helper."""
import subprocess


def sh(args, check=True):
    return subprocess.run(args, check=check, capture_output=True)


def open_pulls(repo):
    return sh(["gh", "pr", "list", "--repo", repo])


def fetch_tags():
    return sh(["git", "fetch", "--tags"])
