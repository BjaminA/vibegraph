"""SM3 fixture: a side effect BEFORE N and one AFTER N.

The scan, bounded by N (x's line), must list only the before-N effect — the
after-N `logging.critical` is past the _VGStop sentinel and never runs, so it
is neither listed nor consented (req 3, stop-at-N bounds effects). With consent
to the before-N effect, the run captures x honestly.
"""

import logging


def main():
    logging.info("before")
    x = 2 + 2
    logging.critical("after")
    return x
