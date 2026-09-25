"""Operator CLI: export a window to a file, or backfill from one."""

import argparse
import sys

from telemetry.backfill import backfill_from_file
from telemetry.export import export_csv
from telemetry.storage import readings_between


def main() -> int:
    parser = argparse.ArgumentParser(description="fleet telemetry ops")
    sub = parser.add_subparsers(dest="command", required=True)
    exp = sub.add_parser("export")
    exp.add_argument("--since", type=int, default=0)
    exp.add_argument("--out", default="export.csv")
    back = sub.add_parser("backfill")
    back.add_argument("path")
    args = parser.parse_args()
    if args.command == "export":
        rows = readings_between(args.since, None)
        with open(args.out, "w", newline="") as handle:
            handle.write(export_csv(rows))
        print(f"wrote {len(rows)} rows to {args.out}")
        return 0
    count = backfill_from_file(args.path)
    print(f"backfilled {count} rows from {args.path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
