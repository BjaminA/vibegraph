def _row_jobs(row):
    return f"job {row}"


def _row_people(row):
    return f"person {row}"


TABLE = {
    "jobs": {"rows": "jobs", "parse": _row_jobs},
    "people": {"rows": "people", "parse": _row_people},
}


def render(kind, rows):
    parse = TABLE[kind]["parse"]
    return [parse(r) for r in rows]
