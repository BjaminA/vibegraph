#!/usr/bin/env bash
# The same shape with the check AFTER the run: a check that comes too late
# guards nothing, so this one stays unguarded.
set -euo pipefail

JOB="$1"
sh -c "$JOB"
validate_job "$JOB"
