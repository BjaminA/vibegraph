#!/usr/bin/env python3
"""
Vendor a scale-benchmark fixture from a real medium Python codebase
(M6 wave 2).

PLAN.md S1.5 M6 spec: scrape an upstream codebase, strip docstrings
and comments, regenerate via libcst's emitter, write to
test/fixtures/scale/src/ + scale_50.ir.json. Default upstream:
Django 4.2 / django/contrib/admin/ (BSD-3 -- attribution carried in
SOURCE.md + LICENSE.upstream).

PLAN-style structural-path name mangling (`function_a_001`,
`Class_b_03`) is deferred: that's a libcst-cross-file rename pass
that takes hundreds of lines to get right, and the benchmark fixture
doesn't need it -- the parser cares about node shape, not identifier
semantics. Docstring/comment stripping alone gives us:
  - deterministic output (same input -> same files)
  - ~30-40% size reduction (no doc strings)
  - upstream churn isolation (paths to ours are flat /src/, not
    nested django/contrib/admin/)

Pipeline:
  fetch -> filter to .py -> libcst transform (strip docs/comments) ->
  flatten to scale/src/<rel_path> -> per-file parse -> link ->
  scale_50.ir.json -> SOURCE.md

Usage:
    python3 scripts/synth_scale_fixture.py            # vendor
    python3 scripts/synth_scale_fixture.py --check    # verify pinned
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from typing import List, Tuple

# ─────────────────────────────────────────── pinned upstream ────────

DEFAULT_REPO = "django/django"
DEFAULT_PIN = "879e5d587b84e6fc961829611999431778eb9f6a"  # tag 4.2
DEFAULT_SUBDIR = "django/contrib/admin"
DEFAULT_LICENSE_PATH = "LICENSE"
DEFAULT_TARGET = "test/fixtures/scale"


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_raw(repo: str, pin: str, path: str) -> bytes:
    url = f"https://raw.githubusercontent.com/{repo}/{pin}/{path}"
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


def list_python_files(repo: str, pin: str, subdir: str) -> List[str]:
    """All .py file paths under subdir (recursive) at pin."""
    api = f"https://api.github.com/repos/{repo}/git/trees/{pin}?recursive=1"
    tree = fetch_json(api)["tree"]
    return sorted(
        t["path"] for t in tree
        if t["path"].startswith(subdir + "/")
        and t["path"].endswith(".py")
        and t["type"] == "blob"
    )


# ─────────────────────────────────────────── libcst transform ──────

def strip_docs_and_comments(source: bytes, vendored_subdir: str) -> str:
    """Parse via libcst, drop module/function/class-leading docstrings,
    drop trailing comments and standalone comment lines, and rewrite
    `<vendored_subdir as dotted prefix>.X` imports to relative form so
    the cross-file linker can resolve admin's internal references.
    Emit via cst's code_for_node so whitespace and structure are
    preserved."""
    import libcst as cst
    # `django/contrib/admin` -> dotted prefix `django.contrib.admin`
    dotted_prefix = vendored_subdir.replace("/", ".")

    class StripVisitor(cst.CSTTransformer):
        def leave_Module(self, original_node, updated_node):
            return self._strip_docstring(updated_node)

        def leave_FunctionDef(self, original_node, updated_node):
            new_body = self._strip_docstring(updated_node.body)
            return updated_node.with_changes(body=new_body)

        def leave_ClassDef(self, original_node, updated_node):
            new_body = self._strip_docstring(updated_node.body)
            return updated_node.with_changes(body=new_body)

        def _strip_docstring(self, node):
            """Drop the leading SimpleStatementLine that wraps a
            single Expr<SimpleString>. Applies to Module body or
            IndentedBlock body."""
            if hasattr(node, "body") and node.body:
                first = node.body[0]
                expr = None
                if isinstance(first, cst.SimpleStatementLine) and first.body:
                    inner = first.body[0]
                    if isinstance(inner, cst.Expr):
                        expr = inner.value
                if expr is not None and isinstance(expr, (cst.SimpleString, cst.ConcatenatedString)):
                    new_body = node.body[1:]
                    if not new_body:
                        # Don't leave a class/function with empty body --
                        # insert a `pass` so the file stays parseable.
                        if isinstance(node, cst.IndentedBlock):
                            new_body = [cst.SimpleStatementLine([cst.Pass()])]
                    return node.with_changes(body=new_body)
            return node

        def leave_Comment(self, original_node, updated_node):
            return cst.RemoveFromParent()

        def leave_EmptyLine(self, original_node, updated_node):
            # Drop the comment but keep the line break, otherwise libcst's
            # emitter can collapse adjacent statements.
            if updated_node.comment is not None:
                return updated_node.with_changes(comment=None)
            return updated_node

        def leave_TrailingWhitespace(self, original_node, updated_node):
            if updated_node.comment is not None:
                return updated_node.with_changes(comment=None)
            return updated_node

    class ImportRewriter(cst.CSTTransformer):
        """Rewrites `from <dotted_prefix>[.X] import Y` to relative
        form. Examples (vendored_subdir = django/contrib/admin):
          from django.contrib.admin import helpers
            -> from . import helpers
          from django.contrib.admin.options import ModelAdmin
            -> from .options import ModelAdmin
          from django.contrib.admin.views.main import ChangeList
            -> from .views.main import ChangeList
        Anything not starting with dotted_prefix is left alone."""

        def leave_ImportFrom(self, original_node, updated_node):
            if updated_node.module is None:
                return updated_node
            module_str = self._dotted_name_str(updated_node.module)
            if module_str == dotted_prefix:
                # `from <prefix> import X` -> `from . import X`
                return updated_node.with_changes(
                    module=None,
                    relative=[cst.Dot()],
                )
            if module_str.startswith(dotted_prefix + "."):
                # `from <prefix>.X.Y import Z` -> `from .X.Y import Z`
                tail = module_str[len(dotted_prefix) + 1:]
                return updated_node.with_changes(
                    module=cst.parse_expression(tail),
                    relative=[cst.Dot()],
                )
            return updated_node

        def _dotted_name_str(self, node) -> str:
            if isinstance(node, cst.Name):
                return node.value
            if isinstance(node, cst.Attribute):
                return f"{self._dotted_name_str(node.value)}.{node.attr.value}"
            return ""

    module = cst.parse_module(source.decode("utf-8"))
    new_module = module.visit(StripVisitor()).visit(ImportRewriter())
    return new_module.code


# ─────────────────────────────────────────── vendor + IR ───────────

def relative_to_subdir(path: str, subdir: str) -> str:
    """`django/contrib/admin/views/main.py` + subdir `django/contrib/admin`
    -> `views/main.py`."""
    assert path.startswith(subdir + "/")
    return path[len(subdir) + 1:]


def write_source_md(target: str, repo: str, pin: str, subdir: str,
                    files: List[Tuple[str, int, int, str]]) -> None:
    """files: [(relative_path, original_size, stripped_size, sha256), ...]."""
    total_orig = sum(f[1] for f in files)
    total_stripped = sum(f[2] for f in files)
    reduction = (1.0 - total_stripped / total_orig) * 100 if total_orig else 0
    body = [
        "# Upstream provenance",
        "",
        "This directory holds the scale-benchmark fixture for M6.",
        "",
        f"- **Repo:** [{repo}](https://github.com/{repo})",
        f"- **Pin:** `{pin}` (tag 4.2)",
        f"- **Subdir:** `{subdir}/`",
        f"- **License:** BSD-3 (see `LICENSE.upstream`)",
        "",
        "Files were fetched at the pinned commit and run through "
        "`scripts/synth_scale_fixture.py`, which uses libcst to strip "
        "module/function/class docstrings and all comments. Names are "
        "NOT mangled -- the parser doesn't care about identifier "
        "semantics, so PLAN.md's deterministic name-mangling pass is "
        "deferred. The deterministic input -> output property holds "
        "via the libcst transform alone.",
        "",
        f"**Vendored size**: {len(files)} files, {total_orig} -> {total_stripped} bytes "
        f"({reduction:.1f}% reduction from doc/comment strip).",
        "",
        "## File inventory",
        "",
    ]
    for rel, orig, stripped, sha in files:
        body.append(f"- `src/{rel}` -- {orig} -> {stripped} bytes -- `sha256:{sha[:16]}...`")
    body += [
        "",
        "## Regenerate",
        "",
        "```",
        "python3 scripts/synth_scale_fixture.py            # vendor",
        "python3 scripts/synth_scale_fixture.py --check    # verify",
        "```",
        "",
        "Bumping the pin is an intentional fixture refresh; do it when "
        "you want a fresh shape, not to chase upstream churn.",
    ]
    with open(os.path.join(target, "SOURCE.md"), "w") as f:
        f.write("\n".join(body) + "\n")


def generate_ir(target: str) -> None:
    """Parse every src/*.py through parse_cst, link cross-file, write
    scale_50.ir.json. Mirrors the bash pipeline used in the M4b
    parser tests."""
    import subprocess
    src_dir = os.path.join(target, "src")
    parse = os.path.abspath("scripts/parse_cst.py")
    linker = os.path.abspath("scripts/cross_file_link.py")
    env = {**os.environ, "PYTHONPATH": os.path.abspath(".pydeps")}
    files = {}
    for root, _, fnames in os.walk(src_dir):
        for fn in sorted(fnames):
            if not fn.endswith(".py"):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, src_dir)
            module_path = rel[:-3].replace(os.sep, ".")
            if module_path.endswith(".__init__"):
                module_path = module_path[:-9]
            r = subprocess.run(
                ["python3", parse, full, "--module-path", module_path],
                capture_output=True, text=True, env=env,
            )
            if r.returncode != 0:
                print(f"  parse fail {rel}: {r.stderr[:120]}", file=sys.stderr)
                continue
            files[rel] = json.loads(r.stdout)
    linked = subprocess.run(
        ["python3", linker], input=json.dumps({"files": files}),
        capture_output=True, text=True, env=env,
    )
    if linked.returncode != 0:
        print(f"  linker fail: {linked.stderr[:200]}", file=sys.stderr)
        return
    out = json.loads(linked.stdout)["files"]
    with open(os.path.join(target, "scale_50.ir.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))  # compact -- this is a big file
    total_nodes = sum(len(ir["nodes"]) for ir in out.values())
    total_edges = sum(len(ir["edges"]) for ir in out.values())
    total_xref = sum(
        sum(1 for e in ir["edges"] if e.get("targetFile")) for ir in out.values()
    )
    print(f"  IR: {len(out)} files, {total_nodes} nodes, {total_edges} edges "
          f"({total_xref} cross-file refs)")


# ─────────────────────────────────────────── CLI ───────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="Vendor a scale-benchmark fixture.")
    ap.add_argument("--repo", default=DEFAULT_REPO)
    ap.add_argument("--pin", default=DEFAULT_PIN)
    ap.add_argument("--subdir", default=DEFAULT_SUBDIR)
    ap.add_argument("--target", default=DEFAULT_TARGET)
    ap.add_argument("--check", action="store_true",
                    help="verify the existing target matches the upstream pin")
    args = ap.parse_args()

    target = os.path.abspath(args.target)
    src_dir = os.path.join(target, "src")
    os.makedirs(src_dir, exist_ok=True)

    print(f"Listing {args.repo}@{args.pin}:{args.subdir}/ ...")
    paths = list_python_files(args.repo, args.pin, args.subdir)
    if not paths:
        print("No .py files found at upstream subdir.", file=sys.stderr)
        return 2

    summary: List[Tuple[str, int, int, str]] = []
    mismatches: List[str] = []

    for path in paths:
        rel = relative_to_subdir(path, args.subdir)
        body = fetch_raw(args.repo, args.pin, path)
        try:
            stripped_text = strip_docs_and_comments(body, args.subdir)
        except Exception as e:
            print(f"  transform fail {rel}: {e}", file=sys.stderr)
            stripped_text = body.decode("utf-8")
        stripped = stripped_text.encode("utf-8")
        sha = hashlib.sha256(stripped).hexdigest()
        summary.append((rel, len(body), len(stripped), sha))
        out_path = os.path.join(src_dir, rel)
        if args.check:
            if not os.path.exists(out_path):
                mismatches.append(f"{rel}: missing locally")
                continue
            with open(out_path, "rb") as f:
                local = f.read()
            if local != stripped:
                mismatches.append(f"{rel}: drifted from upstream pin")
        else:
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with open(out_path, "wb") as f:
                f.write(stripped)
            print(f"  wrote {rel} -- {len(body)} -> {len(stripped)} bytes")

    if args.check:
        if mismatches:
            print("FAIL: vendor drift:", file=sys.stderr)
            for m in mismatches:
                print(f"  {m}", file=sys.stderr)
            return 1
        print(f"OK: {len(summary)} files match upstream pin.")
        return 0

    try:
        license_body = fetch_raw(args.repo, args.pin, DEFAULT_LICENSE_PATH)
    except Exception:
        license_body = b"(LICENSE file not present at upstream root.)\n"
    with open(os.path.join(target, "LICENSE.upstream"), "wb") as f:
        f.write(license_body)
    write_source_md(target, args.repo, args.pin, args.subdir, summary)

    print(f"Vendored. Generating scale_50.ir.json ...")
    generate_ir(target)
    print(f"Done. {len(summary)} .py files in {src_dir}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
