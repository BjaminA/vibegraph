"""The reporting job: lists what lands in the zones it is told to follow."""
import boto3

from datasets import BUCKET


def tail(zones: list) -> None:
    s3 = boto3.client("s3")
    for zone in zones:
        s3.list_objects_v2(Bucket=BUCKET, Prefix=zone)


if __name__ == "__main__":
    tail(["curated"])
