"""Grants on the bucket."""
import json

import boto3

from datasets import BUCKET


def grant_read(team: str, reader_arn: str) -> None:
    s3 = boto3.client("s3")
    policy = {"Statement": [{"Effect": "Allow", "Principal": {"AWS": reader_arn}, "Action": "s3:GetObject", "Resource": f"arn:aws:s3:::{BUCKET}/{team}/raw/*"}]}
    s3.put_bucket_policy(Bucket=BUCKET, Policy=json.dumps(policy))
