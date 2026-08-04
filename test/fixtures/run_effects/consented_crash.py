"""SM3 fixture: a consented effectful path that then crashes before N.

After the user consents to the side effect, the run executes and the program
raises (1/0) before reaching z. That is the PROGRAM's behaviour — it must come
back as an honest runtime-error, not a harness failure (req 5).
"""

import logging


def main():
    logging.info("x")
    y = 1 / 0
    z = 5
    return z
