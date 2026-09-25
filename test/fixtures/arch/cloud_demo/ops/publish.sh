#!/usr/bin/env bash
# Publish the built site to all three clouds.
set -euo pipefail

main() {
  aws s3 cp site.tar.gz s3://releases/site.tar.gz
  gsutil cp site.tar.gz gs://releases/site.tar.gz
  az storage blob upload --container-name releases --file site.tar.gz --name site.tar.gz
}

main "$@"
