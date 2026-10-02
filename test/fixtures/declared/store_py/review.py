"""A dataset's publication review: a job state table and a decision tree."""

JOB_STATES = [
    {"from": "QUEUED", "to": "RUNNING", "roles": ["worker"], "requires": []},
    {"from": "RUNNING", "to": "DONE", "roles": ["worker"], "requires": ["has_output"]},
    {"from": "RUNNING", "to": "FAILED", "roles": ["worker", "operator"], "requires": []},
]

PUBLISH_TREE = {
    "q1": {"question": "Is the dataset under the size limit?", "yes": "q2", "no": "REJECT", "reads": ["Dataset.size"]},
    "q2": {"question": "Has a steward signed it off?", "yes": "PUBLISH", "no": "HOLD", "reads": ["Dataset.steward"]},
}


def check_size(ds) -> bool:
    return ds["size"] < 10_000


def check_steward(ds) -> bool:
    return bool(ds.get("steward"))


PUBLISH_CHECKS = {"q1": check_size, "q2": check_steward}
