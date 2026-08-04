"""M-RUN2.1 fixture — methods run on a synthesized example instance.

Black-clean by construction (probe injection needs black-clean source).
Gauge: pure ctor + pure method — the happy instance-run path.
Logger: ctor does file I/O — the constructor-effect consent path (the
floor must scan __init__, not just the method).
"""


class Gauge:
    def __init__(self, scale=2):
        self.scale = scale

    def reading(self, raw):
        value = raw * self.scale
        return value


class Logger:
    def __init__(self):
        self.sink = open("gauge.log", "w")

    def note(self, msg):
        text = msg + "!"
        return text
