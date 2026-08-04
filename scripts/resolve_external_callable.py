#!/usr/bin/env python3
"""
Resolve an external callable's signature + docstring + source location.

M13.1 — replaces the "External library call — source not available"
tooltip dead-end. Given a qualified name as the IR emits it
(`sqlite3.connect`, `requests.get`, `flask.Flask`, `app.route`),
introspects the running interpreter via importlib + inspect to
return whatever we can learn about the callable.

Usage
-----
    python3 resolve_external_callable.py <qualified.name>

Output: a single JSON line on stdout:

    {
      "qualifiedName": "sqlite3.connect",
      "kind": "stdlib" | "third_party" | "unresolved",
      "signature": "(database, timeout=5.0, detect_types=0, ...)",
      "signatureSource": "inspect" | "stub" | null,
      "docstring": "Open a connection ...",
      "module": "sqlite3",
      "sourceFile": "/usr/lib/python3.11/sqlite3/dbapi2.py",
      "isBuiltin": false,
      "error": null
    }

On unresolvable input, kind="unresolved" and `error` carries the
human-readable reason. The exit code stays 0 — the script's job is
to RETURN the lookup result, not to fail when the lookup fails.

Design notes
------------
- Only imports the first segment of the dotted path via importlib;
  remaining segments are walked via getattr. This is intentional:
  we DO NOT exec user code or run any setup that the package wouldn't
  run on a normal `import`. Side effects of a package's top-level
  module are unavoidable but contained.
- `inspect.signature(obj)` fails on many C-level builtins (open, len,
  isinstance) — we surface those as `signatureSource: null` with a
  reason in `error` rather than calling it a hard fail.
- `inspect.getdoc` is preferred over `obj.__doc__` because it
  un-indents the docstring and strips signature lines that some
  C extensions stuff into __doc__.
- Caching is the caller's job (the WS handler does process-local LRU).
  This script is stateless.
"""

from __future__ import annotations

import importlib
import inspect
import json
import sys
import traceback
from typing import Any, Optional


# Modules that ship with the Python standard library. Determined at
# import time from `sys.stdlib_module_names` (Python 3.10+). Used to
# classify `kind` as "stdlib" vs "third_party".
_STDLIB = set(getattr(sys, "stdlib_module_names", set()))


def _classify(module_name: str, sourceFile: Optional[str]) -> str:
    """Return "stdlib" | "third_party" | "unresolved" for the lookup."""
    if not module_name:
        return "unresolved"
    base = module_name.split(".")[0]
    if base in _STDLIB:
        return "stdlib"
    # Builtin modules (no source file, but real callables) — treat as stdlib.
    if sourceFile is None and base in sys.builtin_module_names:
        return "stdlib"
    return "third_party"


def _import_base(qualified_name: str) -> tuple[Any, str]:
    """
    Import the first segment of `qualified_name` and return (module, base).

    Two paths:
      1. Dotted name (`sqlite3.connect`): import the first segment as a
         module via importlib.
      2. Bare name (`print`, `len`, `range`): try `builtins` first.
         Thread extractor classifies these as external (per
         KNOWN_BUILTINS in extract_thread.py); they all live in the
         `builtins` module. If the bare name isn't a builtin, fall
         back to importing it as a module (covers `os`, `sys`, etc.).
    """
    if not qualified_name:
        raise ValueError("empty qualified name")
    if "." not in qualified_name:
        bare = qualified_name
        import builtins as _builtins
        if hasattr(_builtins, bare):
            return _builtins, "builtins"
        # Bare name that's not a builtin — last chance is that it IS a
        # module (e.g. `os`, `json`). importlib will raise ImportError
        # otherwise, which the caller surfaces as kind=unresolved.
        mod = importlib.import_module(bare)
        return mod, bare
    base = qualified_name.split(".", 1)[0]
    mod = importlib.import_module(base)
    return mod, base


def _walk(obj: Any, path_segments: list[str]) -> Any:
    """Walk getattr on `obj` for each segment in `path_segments`."""
    cur = obj
    for seg in path_segments:
        cur = getattr(cur, seg)
    return cur


def _safe_signature(obj: Any) -> tuple[Optional[str], Optional[str]]:
    """
    Return (signature_str, source_tag). `source_tag` is:
      - "inspect" when inspect.signature() succeeded.
      - "stub" when we fell back to a synthesised "(...)" placeholder
        because inspect raised but we still want to render something.
      - None when we can't even fake a signature.
    """
    try:
        sig = inspect.signature(obj)
        return (str(sig), "inspect")
    except (TypeError, ValueError):
        # Builtins like `len`, `print`, many `os.*` calls don't expose
        # introspectable signatures. Surface a stub so the tooltip can
        # still render `name(...)` rather than nothing.
        if callable(obj):
            return ("(...)", "stub")
        return (None, None)


def _safe_docstring(obj: Any) -> Optional[str]:
    try:
        doc = inspect.getdoc(obj)
        return doc if doc else None
    except Exception:
        return None


def _safe_sourcefile(obj: Any) -> Optional[str]:
    try:
        return inspect.getsourcefile(obj)
    except (TypeError, OSError):
        return None


def _module_of(obj: Any) -> Optional[str]:
    return getattr(obj, "__module__", None)


def resolve(qualified_name: str) -> dict:
    """
    Top-level entry. Returns a JSON-serialisable dict matching the
    output shape documented in the module docstring.

    Never raises — every failure becomes `kind: "unresolved"` plus an
    `error` field carrying the reason.
    """
    out: dict[str, Any] = {
        "qualifiedName": qualified_name,
        "kind": "unresolved",
        "signature": None,
        "signatureSource": None,
        "docstring": None,
        "module": None,
        "sourceFile": None,
        "isBuiltin": False,
        "error": None,
    }
    if not qualified_name or not isinstance(qualified_name, str):
        out["error"] = "qualified name must be a non-empty string"
        return out

    try:
        base_mod, base = _import_base(qualified_name)
    except ImportError as e:
        out["error"] = f"base module '{qualified_name.split('.', 1)[0]}' is not importable: {e}"
        out["module"] = qualified_name.split(".", 1)[0]
        return out
    except ValueError as e:
        out["error"] = str(e)
        return out

    # Two walk shapes:
    #   * qualified == "print" with base == "builtins"  → target is
    #     builtins.print (getattr the bare name).
    #   * qualified == "sqlite3.connect"               → target is
    #     sqlite3.connect (walk rest of the dotted path).
    rest = qualified_name.split(".")[1:]
    try:
        if not rest and base == "builtins" and qualified_name != "builtins":
            target = getattr(base_mod, qualified_name)
        else:
            target = _walk(base_mod, rest) if rest else base_mod
    except AttributeError as e:
        out["error"] = f"attribute walk failed at '{e}': {qualified_name}"
        out["module"] = base
        return out

    # We have the object. Pull what we can from it without crashing.
    sig, sig_src = _safe_signature(target)
    out["signature"] = sig
    out["signatureSource"] = sig_src
    out["docstring"] = _safe_docstring(target)
    out["sourceFile"] = _safe_sourcefile(target)
    module = _module_of(target) or base
    out["module"] = module
    out["isBuiltin"] = inspect.isbuiltin(target)
    out["kind"] = _classify(module, out["sourceFile"])

    # Modules / classes themselves are fine to surface too — the
    # tooltip caller may want to show `flask.Flask`'s class docstring
    # even though it's not technically "called". `inspect.signature`
    # gives us the __init__ for classes when available. So we don't
    # need to special-case here.

    return out


def _cli() -> int:
    if len(sys.argv) != 2:
        print(
            json.dumps({
                "qualifiedName": None,
                "kind": "unresolved",
                "error": "usage: resolve_external_callable.py <qualified.name>",
            })
        )
        return 2
    try:
        result = resolve(sys.argv[1])
    except Exception:
        # Defensive — resolve() should never raise, but if it does we
        # still want a parseable JSON line on stdout.
        result = {
            "qualifiedName": sys.argv[1],
            "kind": "unresolved",
            "error": "internal resolver error: " + traceback.format_exc().splitlines()[-1],
        }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
