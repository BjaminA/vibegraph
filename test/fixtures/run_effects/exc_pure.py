"""PLAN-v7 6d pre-flight finding: builtin exception constructors are pure.

Before the fix, `raise ValueError(...)` classified the bare `ValueError`
callTarget as an UNRESOLVED call (purity unprovable) and the floor refused a
semantically pure check — forcing a needless consent gate. Constructing a
builtin exception has no side effects; the raise is control flow.
"""


def guarded_half(n):
    if n < 0:
        raise ValueError("n must be non-negative")
    if n % 2:
        raise AssertionError("n must be even")
    half = n // 2
    return half
