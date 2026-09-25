"""Alert dedup contract (stdlib unittest)."""

import unittest

from telemetry import alerts


class AlertDedup(unittest.TestCase):
    def setUp(self):
        alerts._last_sent.clear()

    def test_second_page_inside_the_window_is_suppressed(self):
        self.assertTrue(alerts.should_notify("d1", "temp", now=1000))
        self.assertFalse(alerts.should_notify("d1", "temp", now=1000 + alerts.DEDUP_SECONDS - 1))
        self.assertTrue(alerts.should_notify("d1", "temp", now=1000 + alerts.DEDUP_SECONDS))

    def test_windows_are_per_device_and_metric(self):
        self.assertTrue(alerts.should_notify("d1", "temp", now=1000))
        self.assertTrue(alerts.should_notify("d1", "pressure", now=1000))
        self.assertTrue(alerts.should_notify("d2", "temp", now=1000))


if __name__ == "__main__":
    unittest.main()
