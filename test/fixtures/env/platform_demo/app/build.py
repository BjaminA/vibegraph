"""Build steps that behave differently on the CI runner."""
import os


def in_ci():
    return os.environ.get("GITHUB_ACTIONS") == "true" or os.environ.get("CI") == "true"


def api_key():
    return os.environ["MY_API_KEY"]


def log_level():
    return os.environ.get("LOG_LEVEL", "info")
