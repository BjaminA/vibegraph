"""Nightly archive: copy the day's reports to S3, index them in DynamoDB,
and keep a second copy in Google Cloud Storage."""
import argparse

import boto3
from google.cloud import storage


def main() -> None:
    parser = argparse.ArgumentParser(description="archive one day of reports")
    parser.add_argument("day")
    args = parser.parse_args()

    s3 = boto3.client("s3")
    s3.upload_file(f"reports/{args.day}.json", "archive", f"{args.day}.json")

    table = boto3.resource("dynamodb")
    table.Table("reports").put_item(Item={"day": args.day})

    gcs = storage.Client()
    gcs.bucket("archive-copy").blob(f"{args.day}.json").upload_from_filename(f"reports/{args.day}.json")


if __name__ == "__main__":
    main()
