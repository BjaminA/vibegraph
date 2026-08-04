"""Processing step with a non-trivial conditional and a library boundary.

`normalize_conditions` has both arms non-trivial — the thread renderer
should mark the outgoing edge as ambiguous (dashed).
"""

import math

REFERENCE_DENSITY = 1.225
REFERENCE_VELOCITY = 200.0


def normalize_conditions(conditions: dict) -> dict:
    """Fill in missing condition fields. Branches on whether temperature
    was supplied; both arms call other functions and return a full dict."""
    if "temperature" in conditions:
        density = density_from_temperature(conditions["temperature"])
        return {
            "velocity": conditions.get("velocity", REFERENCE_VELOCITY),
            "density": density,
        }
    else:
        velocity = conditions.get("velocity", REFERENCE_VELOCITY)
        density = conditions.get("density", REFERENCE_DENSITY)
        return {
            "velocity": velocity,
            "density": density,
        }


def density_from_temperature(temp_kelvin: float) -> float:
    """Ideal-gas-law density estimate at sea-level pressure."""
    pressure = 101325.0
    specific_gas_constant = 287.05
    return pressure / (specific_gas_constant * temp_kelvin)


def apply_correction_factor(velocity: float, density: float) -> float:
    """Combine velocity and density into a corrected airspeed.
    Calls math.sqrt — a library boundary the thread must mark as external."""
    return velocity * math.sqrt(density / REFERENCE_DENSITY)
