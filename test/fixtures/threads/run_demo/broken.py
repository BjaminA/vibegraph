"""import-error — a module-level import of a package that isn't installed.

Static thread extraction (libcst parse) is unaffected: the unresolved import is
just a name. Only the run harness actually imports the module, so the run fails
with ImportError → the honest `import-error` outcome. Isolated in its own module
so the failing import doesn't poison the other fixtures.
"""

import vg_definitely_missing_pkg_xyz


def double(v):
    return v * v


def needs_dep():
    """import-error — module import fails before the function body runs."""
    r = double(3)
    return r
