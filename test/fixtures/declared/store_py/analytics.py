"""The analytics job: reads raw objects, writes curated ones."""
import sys

import boto3

from datasets import BUCKET, curated_key, raw_key


def curate(team: str, dataset: str) -> None:
    s3 = boto3.client("s3")
    raw = s3.get_object(Bucket=BUCKET, Key=raw_key(team, dataset))
    s3.put_object(Bucket=BUCKET, Key=curated_key(team, dataset), Body=raw["Body"].read())


def main() -> None:
    curate(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
