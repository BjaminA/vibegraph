#!/usr/bin/env python3
"""Probe the analyzed project's third-party imports for importability.

NEXT-ACTIONS §2 (project-env awareness): the runtime uses its own
repo-root `.pydeps` as PYTHONPATH for every subprocess, so an analyzed
project's dependencies must be importable from there for external-call
resolution (and any return-annotation walk into third-party types) to
work. Nothing used to notice the gap — flask had to be hand-installed
and the only symptom was silently-unresolved tooltips.

Contract (mirrors discover_entry_points.py / resolve_external_callable.py):
  stdin:  {"files": {"<relative path>": <per-file IR>, ...}}
  stdout: {"missing": [{"module": "<import root>", "files": ["<rel>", ...]}]}
  Never raises; always exits 0 with valid JSON on stdout.

Detection is import-ROOT based (`flask`, not `flask.views`) and probes
with importlib.util.find_spec, which locates the module WITHOUT
executing its code. Excluded from probing:
  - stdlib roots (sys.stdlib_module_names)
  - the project's own modules (any first path segment of a parsed file)
  - relative imports (import_from with an empty module — libcst keeps
    the leading dots out of the module field)
"""
import json
import sys
import importlib.util


def _import_roots(ir: dict) -> set[str]:
    roots: set[str] = set()
    for node in ir.get("nodes", []):
        if node.get("type") == "import":
            for name in node.get("names", []):
                # "os.path as osp" -> "os"
                dotted = name.split(" ")[0]
                if dotted:
                    roots.add(dotted.split(".")[0])
        elif node.get("type") == "import_from":
            module = node.get("module") or ""
            if module:
                roots.add(module.split(".")[0])
    return roots


def _local_roots(files: dict) -> set[str]:
    local: set[str] = set()
    for rel in files:
        parts = rel.replace("\\", "/").split("/")
        head = parts[0]
        if head.endswith(".py"):
            head = head[: -len(".py")]
        if head and head != "__init__":
            local.add(head)
    return local


def _is_importable(root: str) -> bool:
    try:
        return importlib.util.find_spec(root) is not None
    except Exception:
        # A broken/half-installed package still counts as present — the
        # gap this script surfaces is "not installed", not "unhealthy".
        return True


def check(files: dict) -> list[dict]:
    stdlib = set(getattr(sys, "stdlib_module_names", ()))
    local = _local_roots(files)
    seen: dict[str, list[str]] = {}
    for rel, ir in files.items():
        for root in _import_roots(ir):
            if root in stdlib or root in local:
                continue
            seen.setdefault(root, []).append(rel)
    missing = []
    for root in sorted(seen):
        if not _is_importable(root):
            missing.append({"module": root, "files": sorted(set(seen[root]))})
    return missing


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        files = payload.get("files", {}) or {}
        missing = check(files)
    except Exception:
        missing = []
    json.dump({"missing": missing}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
