"""Entry point for the aerodynamic-drag thread fixture.

`compute_drag` is the canonical seed for thread extraction tests. It threads
across four files: data fetch (data.py) -> conditional normalisation
(processing.py) -> library call (math.sqrt) -> dynamic model dispatch
(registry.py -> models.py via getattr).

It also exercises the two distinct "thread stops here" markers (R3):
  - `model(...)` is GENUINE dynamic dispatch -- `model` is a local bound
    at runtime, so the target is honestly runtime-determined (`dynamic`).
  - `audit_drag(...)` is a RESOLUTION GAP -- a bare name that is neither a
    local binding nor importable/resolvable here, so the extractor can't
    statically find it (`unresolved`). NOT the same as runtime dispatch.
"""

from data import fetch_state, load_aircraft_config
from processing import normalize_conditions, apply_correction_factor
from registry import select_model


def compute_drag(aircraft_id: str, conditions: dict) -> dict:
    """Compute aerodynamic drag for an aircraft under given conditions."""
    config = load_aircraft_config(aircraft_id)
    state = fetch_state(aircraft_id)
    cond = normalize_conditions(conditions)
    velocity = cond["velocity"]
    density = cond["density"]
    corrected = apply_correction_factor(velocity, density)
    model = select_model(config["model_name"])
    drag_coeff = model(corrected, state)
    audit_drag(drag_coeff)
    return {
        "aircraft_id": aircraft_id,
        "drag_coefficient": drag_coeff,
        "velocity": velocity,
    }


if __name__ == "__main__":
    compute_drag("A320", {"velocity": 250.0, "density": 1.225})
