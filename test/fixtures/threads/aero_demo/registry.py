"""Dynamic dispatch boundary.

`select_model` resolves a model by name via `getattr`. The thread extractor
cannot follow this statically — it must emit a 'stops here - dynamic'
terminal at the call site of `select_model` in main.py.
"""

from typing import Callable

import models


def select_model(name: str) -> Callable[[float, dict], float]:
    """Look up a drag model by name. Resolved dynamically -- thread stops."""
    return getattr(models, name)
