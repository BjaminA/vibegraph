"""Ingest contract tests (stdlib unittest; run: python3 -m unittest discover -s telemetry/tests -t .)."""

import unittest

from telemetry.export import EXPORT_COLUMNS, export_csv, parse_export
from telemetry.normalize import normalize_reading
from telemetry.schema import validate_batch, validate_reading


class IngestContract(unittest.TestCase):
    def test_reading_requires_the_four_keys(self):
        problems = validate_reading({"device_id": "d1", "ts": 1})
        self.assertIn("missing metric", problems)
        self.assertIn("missing value", problems)

    def test_batch_shape(self):
        self.assertEqual(validate_batch({"readings": []}), ["readings must not be empty"])
        self.assertEqual(validate_batch({"nope": 1}), ["payload must be {readings: [...]}"])

    def test_fahrenheit_becomes_celsius(self):
        stored = normalize_reading({"device_id": "d1", "ts": 1, "metric": "temp", "value": 212, "unit": "f"}, received_at=5)
        self.assertAlmostEqual(stored["value"], 100.0)
        self.assertEqual(stored["received_at"], 5)

    def test_export_round_trips_and_keeps_the_column_order(self):
        rows = [{"device_id": "d1", "ts": 1, "metric": "temp", "value": 20.5}]
        text = export_csv(rows)
        self.assertEqual(text.splitlines()[0], ",".join(EXPORT_COLUMNS))
        self.assertEqual(EXPORT_COLUMNS[:4], ["device_id", "ts", "metric", "value"])
        back = parse_export(text)
        self.assertEqual(back[0]["device_id"], "d1")


if __name__ == "__main__":
    unittest.main()
