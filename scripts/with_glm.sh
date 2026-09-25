#!/usr/bin/env bash
#
# Run any VibeGraph command against a non-Anthropic gateway that speaks the
# Anthropic Message Protocol — z.ai serving GLM is the case this was written
# for. NOTHING in the codebase changes: every claude spawn site passes
# `{...process.env}` (src/server/run/synth_args.ts, compose_draft.ts,
# build_plan_draft.ts, system_draft.ts, changeset_draft.ts, synth_data.ts,
# both chat backends) and the worker spawn inherits it, so pointing the CLI
# is enough to route the brief, the workers, the reviewer and the chat.
#
#   scripts/with_glm.sh --init                 write the env file skeleton (no key)
#   scripts/with_glm.sh --print                show the route (host + model, never the token)
#   scripts/with_glm.sh --probe                one round trip: does it answer, how fast, as what
#   scripts/with_glm.sh --write-tiers <dir>    write a pin-nothing .vibegraph/models.json
#   scripts/with_glm.sh <cmd> [args...]        run <cmd> with the route applied
#
# THE KEY LIVES IN $HOME, NOT THE REPO. `~/.config/vibegraph/glm.env`, mode
# 600, is outside the working tree entirely, so "never commit secrets" holds
# structurally rather than by remembering a .gitignore line. Override with
# $VG_LLM_ENV. The file is sourced, never echoed; --print and --probe report
# the HOST and the MODEL and nothing else.
#
# THE TIERS MUST PIN NO MODEL. Measured, not assumed: with the default
# settings `tierArgs("routine")` is `["--model","claude-sonnet-5","--effort",
# "low"]`, and that model name goes to whatever gateway is on the other end.
# Whether a gateway maps Claude's names onto its own models is the gateway's
# business and not a claim this project makes, so a run routed off Anthropic
# should pin nothing and let the endpoint's own default (ANTHROPIC_MODEL, or
# the service's) decide — `--write-tiers` does exactly that:
# {thinking: null, routine: "match", worker: "match"} yields [] on all three.
#
# What the audit records: the spawn label gains the service, so a run served
# by GLM reads `claude:glm-5.3@api.z.ai` in .vibegraph/work-run.json rather
# than `claude:default` (src/server/run/synth_args.ts, serviceSuffix).
set -euo pipefail

ENV_FILE="${VG_LLM_ENV:-$HOME/.config/vibegraph/glm.env}"
# The CLI installs to ~/.local/bin, which is not on a non-login shell's PATH
# — reviews/h2h3/run.sh exports the same line for the same reason. Without
# it --probe fails as "claude: command not found", which reads like a broken
# route rather than a missing binary.
export PATH="$HOME/.local/bin:$PATH"

die() { echo "with_glm: $*" >&2; exit 1; }

case "${1:-}" in
  --init)
    [ -e "$ENV_FILE" ] && die "$ENV_FILE already exists — edit it, or remove it first"
    mkdir -p "$(dirname "$ENV_FILE")"
    umask 077
    cat > "$ENV_FILE" <<'SKEL'
# VibeGraph LLM route — sourced by scripts/with_glm.sh. Mode 600, outside
# the repo on purpose. Put the key on the AUTH_TOKEN line and nothing else
# in this file; it is sourced by bash, so no quotes are needed and a stray
# command here would run.
#
# z.ai's Anthropic-protocol endpoint (their docs list Claude Code as a
# supported client). Check the current base URL in their coding-plan docs
# before trusting this line — it is the one thing here that can move.
VG_LLM_ENDPOINT=https://api.z.ai/api/anthropic
#
# THE KEY FOR THE SERVICE ABOVE — a z.ai key here, not an Anthropic one.
# It is named for what it IS. The CLI's own slot is called
# ANTHROPIC_AUTH_TOKEN (verified: the installed binary looks that name up,
# and z.ai's docs say to set it for the same reason — the variable names
# belong to the CLIENT being configured, not to whoever issued the key),
# and this script maps onto it below. Asking for a key under a vendor's
# name in a file that routes AWAY from that vendor is how the wrong
# credential gets pasted in. Setting ANTHROPIC_AUTH_TOKEN directly still
# works, so a line copied from z.ai's docs is not broken by this.
VG_LLM_KEY=
# The model the gateway should serve. It also becomes the MODEL half of the
# audit label, so name what actually runs.
#
# A name outside the CLI's own model catalog is a WARNING, not a rejection
# (measured: `claude --model glm-5.3 -p ...` runs and prints
# "[claude-code:unrecognized_model]"). The consequence is not cosmetic —
# the CLI then ASSUMES a 200k context window and auto-compacts to it. If
# the served model's window is larger, say so on the next line or the
# session silently compacts early; if it is smaller, the CLI will overrun
# it. Left commented because this project has not measured GLM's window,
# and a guessed number here would be worse than the CLI's stated default.
VG_LLM_MODEL=glm-5.3
# CLAUDE_CODE_MAX_CONTEXT_TOKENS=
SKEL
    chmod 600 "$ENV_FILE"
    echo "wrote $ENV_FILE (mode 600)"
    echo "now put the key on the VG_LLM_KEY= line, then: scripts/with_glm.sh --probe"
    exit 0
    ;;
esac

[ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE — run: scripts/with_glm.sh --init"
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# MAP OUR NAMES ONTO THE CLI'S SLOTS. The env file describes a route in
# terms of what each value is; the CLI reads four fixed names and knows no
# others (verified against the installed binary, which looks up
# ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL). Those names
# belong to the client, not to whoever issued the key — which is why z.ai's
# own docs tell you to set an ANTHROPIC_ variable. Either spelling works:
# ours wins where both are set, so a file written from z.ai's instructions
# keeps working and a file written from ours does not need to know the
# client's vocabulary.
ANTHROPIC_BASE_URL="${VG_LLM_ENDPOINT:-${ANTHROPIC_BASE_URL:-}}"
ANTHROPIC_AUTH_TOKEN="${VG_LLM_KEY:-${ANTHROPIC_AUTH_TOKEN:-}}"
ANTHROPIC_MODEL="${VG_LLM_MODEL:-${ANTHROPIC_MODEL:-}}"
export ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN
# `[ -n "$x" ] && export x` would EXIT here under `set -e` when the model is
# unset, because the failed test is the list's status. An unnamed model is a
# valid route (the gateway's default serves), not an error.
if [ -n "$ANTHROPIC_MODEL" ]; then export ANTHROPIC_MODEL; fi
# `set -a` exported the file's own names too, so the key would reach every
# child twice under two spellings. One copy of a secret is enough.
unset VG_LLM_KEY VG_LLM_ENDPOINT VG_LLM_MODEL

[ -n "${ANTHROPIC_BASE_URL:-}" ] || die "$ENV_FILE names no endpoint (VG_LLM_ENDPOINT)"
[ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] || die "$ENV_FILE has no key (the VG_LLM_KEY= line is still empty)"
# Claude Code reads ANTHROPIC_AUTH_TOKEN for a bearer token; an
# ANTHROPIC_API_KEY left over from a normal login would otherwise sit
# alongside it and make which credential is in play ambiguous.
unset ANTHROPIC_API_KEY

HOST="$(printf '%s' "$ANTHROPIC_BASE_URL" | sed -E 's#^[a-z]+://##; s#[/?].*$##; s#^.*@##')"

case "${1:-}" in
  --print)
    echo "env file : $ENV_FILE"
    echo "service  : $HOST"
    echo "model    : ${ANTHROPIC_MODEL:-<the gateway default>}"
    echo "token    : set (${#ANTHROPIC_AUTH_TOKEN} chars, not shown)"
    exit 0
    ;;
  --write-tiers)
    DIR="${2:-}"; [ -n "$DIR" ] || die "--write-tiers needs a project directory"
    [ -d "$DIR" ] || die "no such directory: $DIR"
    mkdir -p "$DIR/.vibegraph"
    # A real per-tier GATEWAY ROUTE (M-GATEWAY), not "pin nothing and hope":
    # the route names the endpoint and its model, and deliberately sends no
    # Claude model name. Routing lives here; the KEY stays in the env file.
    # Deleting the "routes" block is how this project goes back to Anthropic.
    python3 - "$DIR/.vibegraph/models.json" "$ANTHROPIC_BASE_URL" "${ANTHROPIC_MODEL:-}" <<'PY'
import json, sys
path, endpoint, model = sys.argv[1], sys.argv[2], sys.argv[3]
route = {"provider": "claude", "endpoint": endpoint}
if model:
    route["model"] = model
cfg = {"thinking": None, "routine": "match", "worker": "match",
       "routes": {t: dict(route) for t in ("thinking", "routine", "worker")}}
json.dump(cfg, open(path, "w"), indent=2); open(path, "a").write("\n")
print(f"wrote {path} — every tier -> {model or '<endpoint default>'} @ {endpoint}")
PY
    echo "the key is NOT in that file; it stays in $ENV_FILE"
    exit 0
    ;;
  --probe)
    echo "probing $HOST as ${ANTHROPIC_MODEL:-<gateway default>} ..."
    T0=$(date +%s%3N)
    set +e
    OUT="$(timeout 120 claude -p 'Reply with exactly: OK' --output-format json 2>/tmp/vg-glm-probe.err)"
    RC=$?
    set -e
    T1=$(date +%s%3N)
    if [ "$RC" -ne 0 ]; then
      echo "FAILED (exit $RC) after $((T1 - T0)) ms"
      # The CLI puts the endpoint's own error on stderr; it names a bad key
      # or a wrong base URL far better than a guess here would.
      sed -e "s/$ANTHROPIC_AUTH_TOKEN/<token>/g" /tmp/vg-glm-probe.err | head -20
      rm -f /tmp/vg-glm-probe.err
      exit "$RC"
    fi
    # A SUCCESSFUL call still warns on stderr about a model name outside the
    # CLI's catalog, and that warning carries the 200k context-window
    # assumption — exactly the kind of thing a probe exists to surface
    # before a 20-minute run meets it silently.
    if grep -q "unrecognized_model" /tmp/vg-glm-probe.err 2>/dev/null; then
      echo "NOTE: the CLI does not know this model name, so it assumes a 200k"
      echo "      context window and auto-compacts to it. Set"
      echo "      CLAUDE_CODE_MAX_CONTEXT_TOKENS in $ENV_FILE if the real one differs."
    fi
    rm -f /tmp/vg-glm-probe.err
    echo "answered in $((T1 - T0)) ms"
    printf '%s' "$OUT" | head -c 2000
    echo
    # The same string the run file will record, from the same function, so
    # the audit trail is checked here rather than after a 20-minute run.
    node --experimental-strip-types --no-warnings -e '
      import("./src/server/run/synth_args.ts").then(m => {
        console.log("audit label would read:", m.resolveClaudeBin("worker").label);
      });
    ' 2>/dev/null || echo "(label check needs the repo root as cwd)"
    exit 0
    ;;
  "") die "nothing to run. See the header, or: --init | --print | --probe | --write-tiers <dir>" ;;
esac

exec "$@"
