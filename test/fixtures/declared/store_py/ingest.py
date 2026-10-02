"""The ingest job: writes raw objects. It never calls analytics."""
import sys

import boto3

from datasets import BUCKET, dated_key, raw_key


def upload(team: str, dataset: str, body: bytes) -> None:
    s3 = boto3.client("s3")
    s3.put_object(Bucket=BUCKET, Key=raw_key(team, dataset), Body=body)
    s3.put_object(Bucket=BUCKET, Key=dated_key(team, dataset, "x"), Body=body)


if __name__ == "__main__":
    upload(sys.argv[1], sys.argv[2], b"")
