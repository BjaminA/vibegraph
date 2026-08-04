"""Authority fixture: a genuinely pure transitive chain.

`compute` calls `square`, which only does arithmetic — no effect anywhere
on the path up to `result`. The client ALLOWS it and the authoritative
server scan AGREES (pure). This is the negative control for
hidden_effect.py: it proves the floor does not over-refuse honest code.
"""


def square(v):
    return v * v


def compute():
    base = square(6)
    result = base + 4
    return result
