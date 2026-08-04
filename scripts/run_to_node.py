#!/usr/bin/env python3
"""Run an ephemeral probe-patched module and classify the test-run outcome.

Usage: python3 run_to_node.py <patched_file>

M-RUN SM1. The server builds the patched module via two diff-confined CST ops
(never touching the real file):
  * a capture probe inserted AFTER node N:
        print("__VG__::" + __import__("json").dumps(repr(<exprN>)))
    immediately followed by  raise _VGStop()  (the stop-sentinel), and
  * a module-scope scaffold appended at the end:
        class _VGStop(BaseException): pass        # BaseException so a user
        try:                                       # `except Exception` can't
            <entryFn>(...)                         # swallow the stop
            print("__VG_DONE__")                   # fn returned WITHOUT stopping
        except _VGStop:
            pass

This script runs that module (inheriting the cwd / PYTHONPATH the parent set to
the analyzed project root) and reads the markers back from stdout. It captures
STDOUT only — exactly the gap run_block.py left — so the probe is a print.

The patched module is executed under a NON-`__main__` run name (via
runpy.run_path). If it were run as `__main__`, the analyzed module's own
`if __name__ == "__main__": <entry>()` block would fire FIRST — before the
appended `class _VGStop` is defined — so the probe's `raise _VGStop()` would
die with `NameError: name '_VGStop' is not defined` (and the harness scaffold
would never run). Running under a synthetic name neutralizes that guard, so
ONLY the appended scaffold drives execution and the stop-sentinel is always
defined before it is raised.

Marker logic (the honesty core — never collapse distinct outcomes to "no result"):
  * __VG__:: present, no __VG_DONE__, exit 0  -> ok            (clean stop at N)
  * __VG__:: present AND __VG_DONE__           -> stop-not-enforced (ran past N:
                                                  the sentinel was swallowed)
  * no __VG__::, __VG_DONE__, exit 0           -> probe-not-reached (fn ran to
                                                  completion without hitting N)
  * no __VG__::, no __VG_DONE__, ImportError   -> import-error (dep not in env)
  * no __VG__::, no __VG_DONE__, exit != 0     -> runtime-error
  * timed out                                  -> timeout
A repr containing a memory address (` at 0x...`) is non-deterministic -> the
value is returned but flagged value-opaque (never snapshot-asserted).

The probe JSON-ENCODES the repr so it always occupies exactly ONE stdout line.
A bare `repr()` is not single-line — every `torch.nn.Module` renders its layer
stack across many lines — and the marker scan below is line-based, so an
unencoded multi-line repr was silently truncated to its first line
(`WineQualityRegressor(`) and presented as if it were the whole value. Encoding
at the source is what makes the capture lossless; `_decode_capture` reverses it.

Emits one JSON object: {outcome, value, valueOpaque, stdout, stderr, exitCode}.
"""

import json
import os
import re
import subprocess
import sys

CAPTURE = "__VG__::"
DONE = "__VG_DONE__"
OPAQUE_RE = re.compile(r" at 0x[0-9A-Fa-f]+")
IMPORT_RE = re.compile(r"^(ModuleNotFoundError|ImportError)\b", re.M)
# Python 3.13+ colourises tracebacks when a colour env var (e.g. FORCE_COLOR,
# injected by some test runners) is set — even into a captured pipe. The SGR
# codes push the exception name off column 0, breaking IMPORT_RE, and render as
# garbage in the tooltip's stderr <pre>. We disable colour at the source (below)
# AND strip defensively here so classification + display stay clean regardless.
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

TIMEOUT_S = 10

# Execute the patched module under a synthetic run name (never "__main__"), so
# the analyzed module's own `if __name__ == "__main__":` block does NOT fire —
# only the appended harness scaffold drives execution (see module docstring).
_RUN_NAME = "__vg_run__"
_BOOTSTRAP = "import sys, runpy; runpy.run_path(sys.argv[1], run_name=%r)" % _RUN_NAME


# A repr with no useful ceiling (a full tensor, a big dataframe) would swamp
# the tooltip. Cap it — but SAY SO in the value itself, so a cut is never
# mistaken for the whole thing. This is the honest counterpart of the silent
# first-line truncation the JSON encoding removes.
VALUE_MAX = 4000


def _decode_capture(payload: str) -> str:
    """Reverse the probe's JSON encoding of `repr(value)`.

    Falls back to the raw payload when it isn't valid JSON — an older probe
    (pre-encoding) or a hand-built one still reads correctly, just without
    multi-line fidelity. Never raises: a decode problem must not turn a
    successful run into a harness error.
    """
    try:
        decoded = json.loads(payload)
    except (ValueError, TypeError):
        return payload
    if not isinstance(decoded, str):
        return payload
    if len(decoded) > VALUE_MAX:
        return decoded[:VALUE_MAX] + f"\n… [truncated — {len(decoded)} chars total]"
    return decoded


def classify(stdout: str, stderr: str, exit_code: int, timed_out: bool) -> dict:
    if timed_out:
        return {"outcome": "timeout", "value": None, "valueOpaque": False}

    lines = stdout.splitlines()
    capture = None
    for ln in lines:  # last capture wins (loops re-bind; mirror §A discipline)
        if ln.startswith(CAPTURE):
            capture = _decode_capture(ln[len(CAPTURE):])
    completed = any(ln.strip() == DONE for ln in lines)

    if capture is not None:
        opaque = bool(OPAQUE_RE.search(capture))
        if completed:
            # The stop-sentinel did NOT halt execution — code ran past N.
            return {"outcome": "stop-not-enforced", "value": capture, "valueOpaque": opaque}
        return {
            "outcome": "value-opaque" if opaque else "ok",
            "value": capture,
            "valueOpaque": opaque,
        }

    if completed and exit_code == 0:
        return {"outcome": "probe-not-reached", "value": None, "valueOpaque": False}
    if IMPORT_RE.search(stderr or ""):
        return {"outcome": "import-error", "value": None, "valueOpaque": False}
    return {"outcome": "runtime-error", "value": None, "valueOpaque": False}


def run(patched_file: str) -> dict:
    timed_out = False
    stdout = stderr = ""
    code = 0
    # Disable interpreter colour at the source so the captured traceback is
    # plain text (see ANSI_RE note). Belt-and-suspenders with the strip below.
    env = dict(os.environ)
    env["PYTHON_COLORS"] = "0"
    env["NO_COLOR"] = "1"
    env.pop("FORCE_COLOR", None)
    try:
        r = subprocess.run(
            [sys.executable, "-c", _BOOTSTRAP, patched_file],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_S,
            env=env,
        )
        stdout, stderr, code = r.stdout, r.stderr, r.returncode
    except subprocess.TimeoutExpired as e:
        timed_out = True
        stdout = e.stdout if isinstance(e.stdout, str) else ""
        stderr = "Execution timed out (%ds limit)" % TIMEOUT_S
        code = 124
    stdout = ANSI_RE.sub("", stdout)
    stderr = ANSI_RE.sub("", stderr)
    res = classify(stdout, stderr, code, timed_out)
    res.update({"stdout": stdout, "stderr": stderr, "exitCode": code})
    return res


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({
            "outcome": "harness-error", "value": None, "valueOpaque": False,
            "stdout": "", "stderr": "Usage: run_to_node.py <patched_file>", "exitCode": 1,
        }))
        sys.exit(1)
    print(json.dumps(run(sys.argv[1])))
