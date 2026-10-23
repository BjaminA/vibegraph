#!/usr/bin/env bash
# Copy the nightly archive to the bucket and tag it.
set -euo pipefail
aws s3 cp archive.tar.gz "s3://acme-backups/$(date +%F).tar.gz"
git tag "backup-$(date +%F)"
