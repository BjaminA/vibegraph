"""Sitting-2 fixture — MANY unverifiable calls on one path (the torch shape).

`train` binds a receiver from an UNannotated local factory, so every
`rig.<method>()` call is a dynamic offense (R4 honesty: runtime-bound
receiver, purity unprovable) while the runtime path is actually harmless.
This engineers the sitting's consent gate: a long offense list (the list
must scroll, the action row must stay reachable) made of trustable
(non-"effect") offenses — so the "stop asking about unverifiable calls"
session grant applies. The value-of-interest is a RESOLVABLE local call
(`summarize`) so the step renders runnable; the dynamic calls sit upstream
on the path. `train_more` proves the grant is session-wide: after trusting
on `train`, it runs with no gate at all.

Black-clean by construction (probe injection needs black-clean source).
"""


class Rig:
    def warm(self):
        return 1

    def spin(self):
        return 2

    def tilt(self):
        return 3

    def pump(self):
        return 4

    def vent(self):
        return 5

    def cool(self):
        return 6

    def heat(self):
        return 7

    def tick(self):
        return 8

    def tock(self):
        return 9

    def rest(self):
        return 10


def make_rig():
    return Rig()


def summarize(v):
    return v * 2


def train():
    """Long unverifiable path — the consent gate must list, scroll, and offer
    the session category-trust; nothing here actually touches the world."""
    rig = make_rig()
    rig.warm()
    rig.spin()
    rig.tilt()
    rig.pump()
    rig.vent()
    rig.cool()
    rig.heat()
    rig.tick()
    rig.tock()
    rig.rest()
    x = summarize(21)
    return x


def train_more():
    """Second unverifiable path — after the session grant, runs with NO gate."""
    rig = make_rig()
    rig.warm()
    rig.cool()
    y = summarize(5)
    return y
