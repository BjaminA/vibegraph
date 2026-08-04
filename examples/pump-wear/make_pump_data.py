"""Generate pump.csv — a learnable tabular regression dataset.

8 sensor features -> continuous wear score. The relationship is mildly
nonlinear (an MLP beats a linear fit, so "did it learn" is visible), the
noise floor is low, and the file is regenerable: run this script again
and you get the same data (fixed seed).

    PYTHONPATH=<vibegraph>/.pydeps python3 make_pump_data.py
"""
import csv
import numpy as np

rng = np.random.default_rng(7)
N = 400

vibration = rng.uniform(0.1, 2.0, N)
temperature = rng.uniform(20, 90, N)
load = rng.uniform(0.2, 1.0, N)
rpm = rng.uniform(800, 3000, N)
pressure = rng.uniform(1.0, 6.0, N)
humidity = rng.uniform(10, 95, N)
age_years = rng.uniform(0.0, 12.0, N)
flow = rng.uniform(5.0, 40.0, N)

wear = (
    18.0 * vibration**2
    + 0.004 * temperature * rpm / 100.0 * load
    + 2.5 * np.sqrt(age_years)
    + 4.0 * np.sin(pressure)
    + 0.02 * flow
    + rng.normal(0, 1.2, N)
)

with open("pump.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["vibration", "temperature", "load", "rpm", "pressure", "humidity", "age_years", "flow", "wear"])
    for i in range(N):
        w.writerow([
            round(vibration[i], 4), round(temperature[i], 2), round(load[i], 4),
            round(rpm[i], 1), round(pressure[i], 4), round(humidity[i], 2),
            round(age_years[i], 3), round(flow[i], 3), round(wear[i], 4),
        ])
print(f"wrote pump.csv ({N} rows)")
