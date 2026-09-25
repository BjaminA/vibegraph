"""CSV export of readings.

The nightly BI job consumes this file. The column order is the whole
contract with it; the code cannot tell you that — the operators can.
"""

import csv
import io

EXPORT_COLUMNS = ["device_id", "ts", "metric", "value"]


def export_csv(rows: list) -> str:
    """Render rows (dicts) as CSV with the export header."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_COLUMNS)
    for row in rows:
        writer.writerow([row.get(column, "") for column in EXPORT_COLUMNS])
    return buffer.getvalue()


def parse_export(text: str) -> list:
    """Inverse of export_csv, used by backfill and the tests."""
    reader = csv.DictReader(io.StringIO(text))
    return [dict(row) for row in reader]
