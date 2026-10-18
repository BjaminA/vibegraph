#!/usr/bin/env bash
# Run one of the project's task scripts — its path arrives as the second
# argument. The path is checked by a helper before anything runs it.
set -euo pipefail
source "$(dirname "$0")/lib/guards.sh"

guard_rel_path "$2"
TASK="$2"
echo "running $TASK"
bash -c "./tasks/$TASK"
