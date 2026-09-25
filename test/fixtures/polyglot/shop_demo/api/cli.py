"""Ops CLI — export orders as JSON (the sys.exit(main()) idiom the
2026-08-30 discovery fix made seedable)."""
import argparse
import json
import sys

from db import list_orders


def main() -> int:
    parser = argparse.ArgumentParser(description="export orders")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()
    print(json.dumps(list_orders(args.limit)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
