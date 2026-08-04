"""Drag models referenced dynamically by registry.select_model.

The thread tracer should NOT reach into this file from `compute_drag` —
the only path to it is through getattr in registry.py, which is a static
dead-end. These functions exist so the program runs, not so the thread
finds them.
"""

import math


def subsonic(corrected_velocity: float, state: dict) -> float:
    """Drag coefficient model for subsonic flight."""
    altitude_factor = 1.0 - state["altitude"] / 100000.0
    return 0.025 * corrected_velocity * altitude_factor


def supersonic(corrected_velocity: float, state: dict) -> float:
    """Drag coefficient model for supersonic flight."""
    return 0.08 * math.log1p(corrected_velocity) * (1.0 + state["altitude"] / 50000.0)
