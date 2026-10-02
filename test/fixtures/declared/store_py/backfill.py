"""Backfill both prefixes through the funnel."""
import sys

import storage
from datasets import curated_key, raw_key


def main() -> None:
    storage.put(raw_key(sys.argv[1], sys.argv[2]), b"")
    storage.put(curated_key(sys.argv[1], sys.argv[2]), b"")


if __name__ == "__main__":
    main()
