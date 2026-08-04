"""Data-source step of the drag thread.

`fetch_state` is a terminal data node — pretend it hits disk/network.
`load_aircraft_config` crosses into the json stdlib (library boundary).
"""

import json

_CONFIG_CACHE: dict = {}


def fetch_state(aircraft_id: str) -> dict:
    """Load runtime state for an aircraft (stub for disk/network read)."""
    return {
        "altitude": 30000.0,
        "fuel_kg": 12000.0,
        "aircraft_id": aircraft_id,
    }


def load_aircraft_config(aircraft_id: str) -> dict:
    """Load aircraft configuration by id; caches per process."""
    if aircraft_id in _CONFIG_CACHE:
        return _CONFIG_CACHE[aircraft_id]
    raw = '{"model_name": "subsonic", "wing_area": 122.6}'
    config = json.loads(raw)
    _CONFIG_CACHE[aircraft_id] = config
    return config
