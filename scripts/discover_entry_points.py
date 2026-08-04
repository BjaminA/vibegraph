#!/usr/bin/env python3
"""
Entry-point discovery for VibeGraph thread index (M8.2.3).

Pure JSON post-processor. Consumes the project IR map emitted by
cross_file_link.py and emits the EntryPoint[] list that gets folded
into the v2.0 envelope (PLAN-v2.md §1.1, §1.2).

  stdin  : { "files": { filePath: per-file IR (post-link), ... } }
  argv   : --manual-seeds <path>   (optional .vibegraph/manual_seeds.json)
  stdout : { "entryPoints": [EntryPoint, ...] }

Detection rules per PLAN-v2.md §1.2 — all string-match heuristics, no
import resolution, no runtime introspection. False positives surface
as extra rows in the thread index; users can right-click → "Hide".

Precedence (when one function would qualify under multiple kinds):

  route > cli > test > public_api > manual

That is: a Flask handler that's also imported elsewhere is emitted
once with kind=route, not twice with both kinds. Same function never
appears twice in entryPoints[].
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional

# ─────────────────────────────────────────── classification tables ──

ROUTE_DECORATOR_RE = re.compile(
    r'^([a-zA-Z_][a-zA-Z0-9_]*)\.(route|get|post|put|delete|patch|options|head)\s*\('
)
NAME_MAIN_RE = re.compile(r'^\s*__name__\s*==\s*[\'"]__main__[\'"]\s*$')
NAME_MAIN_RE_REVERSED = re.compile(r'^\s*[\'"]__main__[\'"]\s*==\s*__name__\s*$')

CLI_FRAMEWORK_BY_TARGET = {
    "argparse.ArgumentParser": "argparse",
    "click.command": "click",
    "click.group": "click",
    "typer.run": "typer",
    "typer.Typer": "typer",
}
TEST_FUNCNAME_RE = re.compile(r'^test_')


def _is_test_file(file: str) -> bool:
    """Match `test_*.py` or `*_test.py` against the path's basename."""
    base = Path(file).name
    return (base.startswith("test_") and base.endswith(".py")) or base.endswith("_test.py")

# ─────────────────────────────────────────── small helpers ──────────


def is_module_scope(node):
    return node.get("parentId") is None


def find_function_defs(ir):
    return [n for n in ir["nodes"]
            if n["type"] == "function_def" and is_module_scope(n)]


def find_all_function_defs(ir):
    """Every function_def regardless of scope. Route handlers are often
    registered inside an app factory (`def create_app(): @app.route…`) —
    their function_def nodes exist in the IR with a parentId; only
    discovery used to filter them out (NEXT-ACTIONS §2, factory-route
    discovery). The thread extractor seeds from any function_def node,
    so nested handlers extract like module-scope ones."""
    return [n for n in ir["nodes"] if n["type"] == "function_def"]


def find_class_defs(ir):
    return [n for n in ir["nodes"]
            if n["type"] == "class_def" and is_module_scope(n)]


def first_docstring_line(fn):
    doc = fn.get("docstring")
    if not doc:
        return None
    line = doc.splitlines()[0].strip() if doc.splitlines() else ""
    return line or None


def short_summary(fn):
    # M-FS6 — class entries summarize from their docstring too (the
    # launchpad showed bare class rows while function rows had summaries).
    if fn["type"] == "class_def":
        return first_docstring_line(fn)
    if fn["type"] != "function_def":
        return None
    return first_docstring_line(fn) or _signature(fn)


def _signature(fn):
    return f"def {fn['name']}({', '.join(fn.get('params', []))})"


def make_entry(file, fn, kind, framework=None, metadata=None):
    """Build a single EntryPoint row keyed off the function/class node."""
    qualified = f"{Path(file).stem}:{fn['name']}"
    entry = {
        "id": f"{file}:{fn['name']}",
        "kind": kind,
        "file": file,
        "irNodeId": fn["id"],
        "qualifiedName": qualified,
        "label": fn["name"],
    }
    summary = short_summary(fn)
    if summary:
        entry["summary"] = summary
    # `framework` always present (null when not meaningful) so the
    # consumer doesn't have to disambiguate "missing key" from "no
    # framework" — matches the schema's nullable enum shape.
    entry["framework"] = framework
    if metadata:
        entry["metadata"] = metadata
    return entry


def _enclosing_top_level_fn(node, ir, by_id):
    """Walk parentId chain until we hit a module-scope function_def.
    Returns None if the node sits at module scope or inside a class."""
    cur = node
    while cur:
        parent_id = cur.get("parentId")
        if parent_id is None:
            return None
        parent = by_id.get(parent_id)
        if parent is None:
            return None
        if parent["type"] == "function_def" and is_module_scope(parent):
            return parent
        cur = parent
    return None


# ─────────────────────────────────────────── per-kind detectors ─────


def detect_cli(file, ir):
    """`if __name__ == "__main__":` and CLI-framework constructor calls.

    Both signals resolve to the *enclosing top-level function* and
    dedupe on it — `argparse.ArgumentParser()` inside `main()` plus a
    `if __name__: main()` at the bottom emits one entry, not two.
    """
    by_id = {n["id"]: n for n in ir["nodes"]}
    fn_by_name = {f["name"]: f for f in find_function_defs(ir)}
    seen = {}  # fn_id -> entry index

    # Signal 1: top-level `if __name__ == "__main__":` block.
    for n in ir["nodes"]:
        if n["type"] != "if_stmt" or not is_module_scope(n):
            continue
        cond = n.get("condition", "")
        if not (NAME_MAIN_RE.match(cond) or NAME_MAIN_RE_REVERSED.match(cond)):
            continue
        # Find function calls / call-RHS assignments inside this block
        # (parentId == this if_stmt) whose funcName matches a top-level
        # function in the same file.
        for c in ir["nodes"]:
            if c.get("parentId") != n["id"]:
                continue
            target_name = None
            if c["type"] == "call":
                target_name = (c.get("funcName") or "").split(".")[0]
            elif c["type"] == "assignment" and c.get("valueKind") == "call":
                target_name = (c.get("callTarget") or "").split(".")[0]
            if target_name and target_name in fn_by_name:
                fn = fn_by_name[target_name]
                if fn["id"] not in seen:
                    seen[fn["id"]] = make_entry(file, fn, kind="cli")

    # Signal 2: argparse / click / typer construction anywhere in the
    # file. Resolves to the enclosing top-level function (the `main`
    # that builds the parser). Back-fills framework if signal 1 already
    # registered the same fn.
    for n in ir["nodes"]:
        target = n.get("funcName") or n.get("callTarget")
        if target not in CLI_FRAMEWORK_BY_TARGET:
            continue
        framework = CLI_FRAMEWORK_BY_TARGET[target]
        enclosing = _enclosing_top_level_fn(n, ir, by_id)
        if enclosing is None:
            # Top-level argparse build — still a cli; treat the if-name
            # block's first call as the entry, or skip.
            continue
        if enclosing["id"] in seen:
            seen[enclosing["id"]]["framework"] = framework
        else:
            seen[enclosing["id"]] = make_entry(file, enclosing, kind="cli",
                                               framework=framework)
    return list(seen.values())


def detect_route(file, ir):
    """Flask / FastAPI route handlers via decorator-name string match,
    plus call-registered handlers (`app.add_url_rule(..., view_func=f)`).

    Handlers are matched at ANY scope, not just module scope — factory
    apps register routes inside `create_app()` and pre-fix those all
    collapsed to a generic "Backend" card with no route threads.

    Framework discriminator:
      1. import shape: `from flask` → flask, `from fastapi` → fastapi
      2. otherwise: receiver convention (app/bp → flask; router → fastapi)
    """
    entries = []
    framework = _file_framework(ir)
    for fn in find_all_function_defs(ir):
        for dec in fn.get("decorators", []):
            m = ROUTE_DECORATOR_RE.match(dec)
            if not m:
                continue
            receiver, verb = m.group(1), m.group(2)
            fw = framework or _receiver_framework(receiver)
            entries.append(make_entry(file, fn, kind="route",
                                      framework=fw,
                                      metadata=_route_metadata(dec, verb)))
            break  # one entry per function even if multi-decorated
    # Decorator entries first: discover()'s claim() dedups by irNodeId,
    # so a handler that is both decorated and add_url_rule'd keeps its
    # richer decorator metadata.
    entries.extend(_add_url_rule_routes(file, ir, framework))
    return entries


_IDENT_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')
_VIEW_FUNC_KWARG_RE = re.compile(r'^view_func\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)$')


def _add_url_rule_routes(file, ir, framework):
    """Flask's non-decorator registration: app.add_url_rule(rule,
    endpoint, view_func=handler). Call nodes carry funcName + raw arg
    source strings, which is enough to bind the handler by name within
    the same file. Cross-file view_func targets are out of scope (they
    would need the linker, and same-file is the overwhelmingly common
    shape)."""
    fns_by_name = {}
    for fn in find_all_function_defs(ir):
        fns_by_name.setdefault(fn["name"], fn)
    entries = []
    for n in ir["nodes"]:
        if n.get("type") != "call":
            continue
        func = n.get("funcName", "")
        if not func.endswith(".add_url_rule"):
            continue
        args = [a.strip() for a in n.get("args", [])]
        route = None
        target = None
        for a in args:
            kw = _VIEW_FUNC_KWARG_RE.match(a)
            if kw:
                target = kw.group(1)
            elif route is None and len(a) >= 2 and a[0] in "'\"" and a[-1] == a[0]:
                route = a[1:-1]
        # Positional form: add_url_rule(rule, endpoint, view_func)
        if target is None and len(args) >= 3 and _IDENT_RE.match(args[2]):
            target = args[2]
        if target is None:
            continue
        fn = fns_by_name.get(target)
        if fn is None:
            continue
        receiver = func.split(".")[0]
        fw = framework or _receiver_framework(receiver)
        entries.append(make_entry(file, fn, kind="route", framework=fw,
                                  metadata={"route": route} if route else None))
    return entries


def _file_framework(ir):
    for n in ir["nodes"]:
        if n["type"] == "import_from":
            mod = n.get("module", "")
            if mod == "flask" or mod.startswith("flask."):
                return "flask"
            if mod == "fastapi" or mod.startswith("fastapi."):
                return "fastapi"
        elif n["type"] == "import":
            for name in n.get("names", []):
                bare = name.split(" as ")[0].strip()
                if bare == "flask" or bare.startswith("flask."):
                    return "flask"
                if bare == "fastapi" or bare.startswith("fastapi."):
                    return "fastapi"
    return None


def _receiver_framework(receiver):
    if receiver in ("app", "bp"):
        return "flask"
    if receiver == "router":
        return "fastapi"
    return None


_ROUTE_PATH_RE = re.compile(r'\(\s*[\'"]([^\'"]+)[\'"]')
_METHODS_RE = re.compile(r'methods\s*=\s*\[([^\]]+)\]')
_HTTP_VERBS = ("get", "post", "put", "delete", "patch", "options", "head")


def _route_metadata(decorator_src, verb):
    md = {}
    p = _ROUTE_PATH_RE.search(decorator_src)
    if p:
        md["route"] = p.group(1)
    if verb in _HTTP_VERBS:
        md["method"] = verb.upper()
    else:
        m = _METHODS_RE.search(decorator_src)
        if m:
            methods = [t.strip().strip('"').strip("'").upper()
                       for t in m.group(1).split(",")]
            md["method"] = methods[0] if len(methods) == 1 else methods
    return md or None


def detect_public_api(file, ir, all_files, already_seeded_ids):
    """Module-scope function_def / class_def with at least one
    incoming cross-file `reference` edge from a different file.
    Skips anything already classified by a higher-precedence kind."""
    entries = []
    fn_by_id = {n["id"]: n
                for n in (find_function_defs(ir) + find_class_defs(ir))}
    incoming_names = set()
    for src_file, src_ir in all_files.items():
        if src_file == file:
            continue
        for e in src_ir.get("edges", []):
            if e.get("targetFile") != file:
                continue
            qt = e.get("qualifiedTarget", "")
            if ":" in qt:
                incoming_names.add(qt.split(":", 1)[1])
    for fn_id, fn in fn_by_id.items():
        if fn_id in already_seeded_ids:
            continue
        if fn["name"] in incoming_names:
            entries.append(make_entry(file, fn, kind="public_api"))
    return entries


def detect_test(file, ir):
    """`def test_*` at module scope inside a test_*.py / *_test.py file."""
    if not _is_test_file(file):
        return []
    entries = []
    for fn in find_function_defs(ir):
        if not TEST_FUNCNAME_RE.match(fn["name"]):
            continue
        entries.append(make_entry(file, fn, kind="test", framework="pytest"))
    return entries


def _is_nn_module(cls):
    """True for a class whose bases name nn.Module (PyTorch). String-match
    heuristic like the rest of discovery — `nn.Module` / `torch.nn.Module`
    / a bare `Module` all qualify on the leaf segment."""
    for b in cls.get("bases", []):
        if b.split(".")[-1] == "Module":
            return True
    return False


def detect_model_forward(file, ir):
    """PyTorch nn.Module subclasses → surface each model's `forward()` as an
    entry point.

    `forward(x)` IS the model's data path. Without this an ML project (no
    routes / CLI / tests / cross-file imports) discovers nothing and the
    thread index is empty — the bug this fixes. The architecture view
    already derives the same forward sequence; this makes it reachable from
    the thread launchpad too. id/label are CLASS-qualified
    (`Model.forward`) so multiple models in one file don't collide.
    """
    entries = []
    forward_by_class = {}
    for n in ir["nodes"]:
        if n["type"] == "function_def" and n.get("name") == "forward":
            forward_by_class[n.get("parentId")] = n
    for cls in find_class_defs(ir):
        if not _is_nn_module(cls):
            continue
        forward = forward_by_class.get(cls["id"])
        if forward is None:
            continue
        cls_name = cls.get("name", "")
        entry = {
            "id": f"{file}:{cls_name}.forward",
            "kind": "model",
            "file": file,
            "irNodeId": forward["id"],
            "qualifiedName": f"{Path(file).stem}:{cls_name}.forward",
            "label": f"{cls_name}.forward",
            "framework": "pytorch",
        }
        summary = short_summary(forward)
        if summary:
            entry["summary"] = summary
        entries.append(entry)
    return entries


def merge_manual_seeds(seeds_path: Optional[str], all_files):
    """Load .vibegraph/manual_seeds.json if present; produce EntryPoint
    rows of kind=manual for each seed that resolves against the loaded
    project. Seeds whose file/irNodeId no longer resolve are silently
    dropped (they may belong to a stale checkout)."""
    if not seeds_path:
        return []
    p = Path(seeds_path)
    if not p.exists():
        return []
    raw = json.loads(p.read_text())
    seeds = raw.get("seeds", []) if isinstance(raw, dict) else raw
    out = []
    for s in seeds:
        f, node_id = s.get("file"), s.get("irNodeId")
        if not f or not node_id or f not in all_files:
            continue
        ir = all_files[f]
        fn = next((n for n in ir["nodes"] if n["id"] == node_id), None)
        if fn is None or fn["type"] not in ("function_def", "class_def"):
            continue
        out.append(make_entry(f, fn, kind="manual"))
    return out


# ─────────────────────────────────────────── orchestration ──────────


def discover(all_files, manual_seeds_path: Optional[str] = None):
    """Run all detectors with precedence dedup. Returns EntryPoint[]
    sorted route → cli → test → public_api → manual, alphabetical
    within each group (matches PLAN-v2.md §1.3 launchpad sort)."""
    by_kind = {"route": [], "model": [], "cli": [], "test": [], "public_api": [], "manual": []}
    seeded_ids = set()

    def claim(entries, bucket):
        for e in entries:
            key = (e["file"], e["irNodeId"])
            if key in seeded_ids:
                continue
            seeded_ids.add(key)
            by_kind[bucket].append(e)

    # Higher precedence first so same-function dedup keeps the more
    # specific kind.
    for file, ir in all_files.items():
        claim(detect_route(file, ir), "route")
    for file, ir in all_files.items():
        claim(detect_model_forward(file, ir), "model")
    for file, ir in all_files.items():
        claim(detect_cli(file, ir), "cli")
    for file, ir in all_files.items():
        claim(detect_test(file, ir), "test")
    # public_api needs the seeded set to skip route/cli/test entries.
    seeded_node_ids = {e["irNodeId"] for bucket in by_kind.values() for e in bucket}
    for file, ir in all_files.items():
        for e in detect_public_api(file, ir, all_files, seeded_node_ids):
            key = (e["file"], e["irNodeId"])
            if key in seeded_ids:
                continue
            seeded_ids.add(key)
            by_kind["public_api"].append(e)
    # Manual seeds are last — already-seeded functions stay under their
    # auto-detected kind.
    for e in merge_manual_seeds(manual_seeds_path, all_files):
        key = (e["file"], e["irNodeId"])
        if key in seeded_ids:
            continue
        seeded_ids.add(key)
        by_kind["manual"].append(e)

    out = []
    for kind in ("route", "model", "cli", "test", "public_api", "manual"):
        out.extend(sorted(by_kind[kind], key=lambda e: e["qualifiedName"]))
    return out


def main():
    ap = argparse.ArgumentParser(description="VibeGraph entry-point discovery")
    ap.add_argument("--manual-seeds", default=None,
                    help="Path to .vibegraph/manual_seeds.json (optional)")
    args = ap.parse_args()

    raw = sys.stdin.read()
    payload = json.loads(raw)
    all_files = payload.get("files", {})
    entries = discover(all_files, manual_seeds_path=args.manual_seeds)
    json.dump({"entryPoints": entries}, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
