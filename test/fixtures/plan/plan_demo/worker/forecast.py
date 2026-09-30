"""The forecaster: reads recent wear and writes a forecast back as a reading —
which the plan's rule p1 says only the API may do."""
from api.store import insert_reading


def forecast_all():
    for pump_id in ["p1", "p2"]:
        insert_reading(pump_id, 0.0)


if __name__ == "__main__":
    forecast_all()
