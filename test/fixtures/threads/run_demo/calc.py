"""Run-to-node e2e fixture — each function engineers one honest outcome.

Black-clean by construction (the probe injection needs black-clean source,
else the M2 diff-confinement rejects black's reformatting → unsupported-target).
Every value-of-interest is an assignment whose RHS is a resolvable local call,
because only `assignment` nodes with valueKind=call render as runnable thread
steps (extract_thread.py) AND the run pre-gate captures a plain-identifier
assignment (runToNode.ts).
"""


def double(v):
    return v * v


def boom():
    return 1 / 0


def the_callback():
    return 0


def passthrough(x):
    return x


def happy():
    """ok — pure no-arg path, captures result = 400."""
    result = double(20)
    return result


def report():
    """M-RUN3 — the value lives in a RETURN, not an assignment: the double
    step's call site is `return double(21)`, so run-to-here routes through
    the capture probe (real value 441; only the holding name is synthetic)."""
    return double(21)


def scaled(n):
    """synth — needs an argument; the path itself is pure."""
    out = double(n)
    return out


def crashed():
    """runtime-error — raises (1/0) before reaching N (z)."""
    bad = boom()
    z = double(2)
    return z


def not_reached():
    """probe-not-reached — N (x) sits in a branch that never runs."""
    if False:
        x = double(1)
        return x
    return 0


def opaque():
    """value-opaque — captured value is a function object (repr has a 0x addr).

    The call (passthrough) and its argument (the_callback) both resolve to
    local pure functions, so the path stays pure with no unresolved terminal —
    the value is genuinely opaque, not a resolution gap.
    """
    obj = passthrough(the_callback)
    return obj


def swallowed():
    """stop-not-enforced — a bare except swallows the _VGStop sentinel."""
    try:
        v = double(3)
    except BaseException:
        pass
    return v
