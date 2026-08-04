"""A job runner exercising the full try / except / finally control flow.

`run_job` is imported by app.py, so the M8.2 discovery pass surfaces it
as a public_api entry point. Its bands each place a call (on the `store`
parameter — dynamic dispatch per §5.5a) so the thread promotes a try /
except / finally container for each, and both returns sit inside a band.
"""


def run_job(payload, store):
    store.begin()
    try:
        record = store.write(payload)
        return record
    except ValueError:
        store.rollback()
        return None
    finally:
        store.close()
