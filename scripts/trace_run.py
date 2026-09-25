#!/usr/bin/env python3
"""Run an entry point under a profiler and report what every call site called.

Usage: python3 trace_run.py <file> <entryFn> [projectRoot]

PLAN-M-RUNTIME phase 3 — the BATCH version of B5's Observe. Observe samples
ONE receiver; this runs an entry point once and reports the real callee at
EVERY call site the run touched, so a whole thread's dynamic dispatches can
be annotated from a single consented run.

Unlike run_to_node.py this patches NOTHING. There is no probe to insert and
no scaffold to append: `sys.setprofile` sees every call from the outside, so
the analyzed file is read and executed exactly as written. A trace cannot
misreport what a rewrite did to the code, because there was no rewrite.

The module is executed under a NON-`__main__` run name for the same reason
run_to_node.py does it: the analyzed module's own `if __name__ ==
"__main__":` block must not fire, or the run would be the module's, not the
entry point's.

WHAT IS RECORDED, and why it is shaped this way:

    (caller file, caller line)  ->  [ {callee, count}, ... ]

A call site is keyed by WHERE THE CALL IS WRITTEN, which is the only thing
that can be joined back to an IR node. The value is a LIST because one site
can genuinely dispatch to different callees within a single run — a loop
over a heterogeneous list is the ordinary case — and collapsing that to "the
callee" would be exactly the kind of tidy lie this project keeps refusing.
Two dispatches means two entries.

Every observation is still ONE RUN on ONE set of inputs. The honesty label
lives with the consumer (src/server/observe.ts's OBSERVE_NOTE); this script's
job is to be accurate about what happened, not to characterise it.

Emits one JSON object:
  {outcome, observations: [{file, line, callees: [{callee, count}]}],
   entryFn, stdout, stderr, error}

Outcomes:
  ok                 the entry function ran to completion
  unsupported-target the entry function needs arguments, or isn't there
  import-error       a dependency is missing from the environment
  runtime-error      the entry function raised
  harness-error      the tracer itself failed

A runtime-error still returns every observation collected BEFORE the raise:
a run that dies halfway has still told you what the first half dispatched to,
and discarding that would be throwing away evidence we already paid for.
"""

import inspect
import io
import json
import os
import re
import runpy
import sys
import traceback

ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
IMPORT_RE = re.compile(r"^(ModuleNotFoundError|ImportError)\b", re.M)
_RUN_NAME = "__vg_trace__"

# A pathological run (a tight loop over thousands of dispatches) must not
# produce an overlay bigger than the project. Distinct SITES are capped, not
# call counts — counts stay exact.
MAX_SITES = 5000


class _Tracer:
    """Collect (caller file, caller line) -> callee qualname, with counts."""

    def __init__(self, roots, run_name_module=None):
        # Only record call sites written INSIDE the analyzed project. A trace
        # of the whole interpreter would bury the project's own dispatches
        # under thousands of frames from site-packages, and an IR node can
        # only ever be joined to a project file anyway.
        self.roots = [os.path.realpath(r) for r in roots]
        # ...and never this file. The tracer calling the entry function IS a
        # call site inside whatever directory the harness lives in, and
        # reporting it would put the harness in the project's own overlay.
        self.skip = os.path.realpath(__file__)
        # runpy gives the analyzed module a synthetic __name__ so its
        # `__main__` guard cannot fire; that name must not leak into a callee
        # a human reads. Map it back to the module the file actually is.
        self.run_name_module = run_name_module
        self.sites = {}
        self.truncated = False

    def _owned(self, filename):
        if not filename or filename.startswith("<"):
            return False
        try:
            real = os.path.realpath(filename)
        except OSError:
            return False
        if real == self.skip:
            return False
        return any(
            real == r or real.startswith(r + os.sep) for r in self.roots
        )

    def _record(self, filename, lineno, callee):
        if not callee or not self._owned(filename):
            return
        if self.run_name_module and callee.startswith(_RUN_NAME + "."):
            callee = self.run_name_module + callee[len(_RUN_NAME):]
        key = (filename, lineno)
        if key not in self.sites:
            if len(self.sites) >= MAX_SITES:
                self.truncated = True
                return
            self.sites[key] = {}
        self.sites[key][callee] = self.sites[key].get(callee, 0) + 1

    def __call__(self, frame, event, arg):
        try:
            if event == "call":
                # `frame` is the CALLEE's frame; its caller holds the site.
                back = frame.f_back
                if back is None:
                    return
                code = frame.f_code
                module = frame.f_globals.get("__name__") or "?"
                qual = getattr(code, "co_qualname", code.co_name)
                self._record(back.f_code.co_filename, back.f_lineno, f"{module}.{qual}")
            elif event == "c_call":
                # `frame` IS the caller here, and `arg` is the C function.
                mod = getattr(arg, "__module__", None) or "builtins"
                qual = getattr(arg, "__qualname__", None) or getattr(arg, "__name__", None)
                if qual:
                    self._record(frame.f_code.co_filename, frame.f_lineno, f"{mod}.{qual}")
        except Exception:  # noqa: BLE001 - a tracer must never break the run
            pass

    def observations(self):
        out = []
        for (filename, lineno), callees in sorted(self.sites.items()):
            out.append({
                "file": filename,
                "line": lineno,
                "callees": [
                    {"callee": c, "count": n}
                    for c, n in sorted(callees.items(), key=lambda kv: (-kv[1], kv[0]))
                ],
            })
        return out


def trace(path: str, entry_fn: str, project_root: str | None = None) -> dict:
    result = {
        "outcome": "harness-error", "observations": [], "entryFn": entry_fn,
        "stdout": "", "stderr": "", "error": None,
    }
    # The project root is given by the caller when it knows it (the server
    # always does). Falling back to the analyzed file's own directory keeps
    # the CLI usable, and is deliberately NOT os.getcwd(): running the tracer
    # from the VibeGraph checkout would make the checkout "the project".
    root = project_root or os.path.dirname(os.path.realpath(path)) or "."
    tracer = _Tracer([root], run_name_module=os.path.splitext(os.path.basename(path))[0])
    captured = io.StringIO()
    try:
        # Load the module WITHOUT tracing — import-time work is not what the
        # entry point does, and profiling it would attribute the module's
        # top-level to whichever line happened to trigger the import.
        import contextlib
        with contextlib.redirect_stdout(captured):
            glb = runpy.run_path(path, run_name=_RUN_NAME)
    except BaseException as exc:  # noqa: BLE001
        result["stdout"] = captured.getvalue()
        result["stderr"] = traceback.format_exc()
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["outcome"] = "import-error" if IMPORT_RE.search(result["stderr"]) else "runtime-error"
        return result

    fn = glb.get(entry_fn)
    if not callable(fn):
        result["outcome"] = "unsupported-target"
        result["error"] = f"{entry_fn} is not a callable in {os.path.basename(path)}"
        result["stdout"] = captured.getvalue()
        return result
    try:
        sig = inspect.signature(fn)
        required = [
            p for p in sig.parameters.values()
            if p.default is inspect.Parameter.empty
            and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
        ]
    except (TypeError, ValueError):
        required = []
    if required:
        # Declining is the honest answer. Inventing arguments is what the
        # synth chokepoint exists for, under its own consent; a tracer must
        # not quietly fabricate the inputs whose effects it is reporting.
        result["outcome"] = "unsupported-target"
        result["error"] = (
            f"{entry_fn} needs argument(s): {', '.join(p.name for p in required)} — "
            "trace runs only take an entry point that runs on its own"
        )
        result["stdout"] = captured.getvalue()
        return result

    try:
        import contextlib
        with contextlib.redirect_stdout(captured):
            sys.setprofile(tracer)
            try:
                fn()
            finally:
                sys.setprofile(None)
        result["outcome"] = "ok"
    except BaseException as exc:  # noqa: BLE001
        sys.setprofile(None)
        result["stderr"] = traceback.format_exc()
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["outcome"] = "import-error" if IMPORT_RE.search(result["stderr"]) else "runtime-error"
    # Collected either way: half a run is still evidence about that half.
    result["observations"] = tracer.observations()
    result["truncated"] = tracer.truncated
    result["stdout"] = captured.getvalue()
    result["stderr"] = ANSI_RE.sub("", result["stderr"])
    return result


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        print(json.dumps({
            "outcome": "harness-error", "observations": [], "entryFn": None,
            "stdout": "", "stderr": "Usage: trace_run.py <file> <entryFn> [projectRoot]", "error": "bad usage",
        }))
        sys.exit(1)
    os.environ["PYTHON_COLORS"] = "0"
    os.environ["NO_COLOR"] = "1"
    print(json.dumps(trace(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)))
