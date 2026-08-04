"""M-RUN2.3 fixture — a thread that reads a data file that may not exist.

Black-clean. load_rows reads data/signals.csv (an fs effect → the consent
gate) and the capture is `count = count_rows(rows)` — a resolved-call
assignment, so the thread renders a runnable step node for it.
"""


def count_rows(rows):
    total = len(rows)
    return total


def load_rows():
    rows = []
    with open("data/signals.csv") as f:
        for line in f:
            rows.append(line.strip())
    count = count_rows(rows)
    return count
