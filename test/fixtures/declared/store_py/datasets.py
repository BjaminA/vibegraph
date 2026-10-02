"""The dataset catalogue: every key prefix in the bucket, who writes it, who reads it.

Keys are computed per team and dataset, so no literal names one."""

BUCKET = "lake"

DATASETS = [
    {"prefix": "{team}/raw/{dataset}", "writers": ["ingest"], "readers": ["analytics", "audit"]},
    {"prefix": "{team}/curated/{dataset}", "writers": ["analytics"], "readers": ["reporting"]},
    {"prefix": "shared/reference/{name}", "writers": ["admin"], "readers": ["ingest", "analytics"]},
]

RETENTION = {"raw": 30, "curated": 365}

# The zone each prefix lives in (one bucket policy per zone).
ZONE_OF = {
    "{team}/raw/{dataset}": "raw_{team}",
    "{team}/curated/{dataset}": "curated",
    "shared/reference/{name}": "reference",
}


def raw_key(team: str, dataset: str) -> str:
    """The raw prefix of one team's dataset."""
    return f"{team}/raw/{dataset}"


def curated_key(team, dataset):
    return team + "/curated/" + dataset


def dated_key(team: str, dataset: str, stamp: str) -> str:
    """A name that depends on a lookup: not reducible."""
    return "/".join(part for part in (team, "raw", dataset, stamp) if part)
