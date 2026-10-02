"""The catalogue repository on the object store."""
import json

import boto3

from catalog import CatalogRepo
from datasets import BUCKET


class S3CatalogRepo(CatalogRepo):
    def save(self, name: str, meta: dict) -> None:
        s3 = boto3.client("s3")
        s3.put_object(Bucket=BUCKET, Key=f"catalog/{name}.json", Body=json.dumps(meta))

    def get(self, name: str) -> dict:
        s3 = boto3.client("s3")
        return json.loads(s3.get_object(Bucket=BUCKET, Key=f"catalog/{name}.json")["Body"].read())
