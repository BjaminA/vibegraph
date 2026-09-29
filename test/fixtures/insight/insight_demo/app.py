"""insight_demo — the GUI insight fixture (test/e2e/insight.spec.ts).

The entry point reads one declared and one undeclared environment variable
and calls into lib.py; tests/test_lib.py tests the helper it calls.
"""
import os

import lib


def main():
    key = os.environ["API_KEY"]
    region = os.getenv("REGION")
    return lib.helper(key, region)


if __name__ == "__main__":
    main()
