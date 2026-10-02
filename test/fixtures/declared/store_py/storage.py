"""A funnel: every write goes through put(), whatever it writes."""
import boto3

from datasets import BUCKET


def put(key: str, body: bytes) -> None:
    boto3.client("s3").put_object(Bucket=BUCKET, Key=key, Body=body)
