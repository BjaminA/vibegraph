"""B2 ephemeral-override e2e fixture — black-clean by construction.

A pure chain where an upstream assignment (`base`) feeds a downstream
value-of-interest (`result`), so overriding `base` changes the captured
`result` without any disk write. Mirrors run_demo's black-clean discipline
(the probe injection needs black-clean source, else M2 diff-confinement
rejects black's reformatting -> unsupported-target).
"""


def double(v):
    return v * v


def chained():
    """override — base feeds result; override base to change result."""
    base = double(2)
    result = double(base)
    return result
