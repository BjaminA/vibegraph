"""Entry surface — imports run_job so the discovery pass marks it
public_api (the thread index then offers jobs.py:run_job)."""
from jobs import run_job


def main(store):
    result = run_job({"id": 1}, store)
    return result
