"""B5 runtime-observation e2e fixture — black-clean by construction.

`eng` is bound from a local factory (make_engine), so `eng.run()` is a DYNAMIC
dispatch (a method on a runtime-bound receiver) the static linker leaves
unresolved-to-a-target. Observing type(eng) at runtime reveals the actual
target — Engine — a runtime sample, never promoted to a static fact. The path
is pure (no effects), so the happy observation needs no consent.
"""


class Engine:
    def run(self):
        return 42


def make_engine():
    return Engine()


def dispatch():
    eng = make_engine()
    out = eng.run()
    return out
