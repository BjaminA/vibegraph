#!/usr/bin/env python3
"""
CST-backed structured rewriter for VibeGraph.

Replaces the legacy scripts/rewrite_node.py (line splices + regex rename).
Operates on structural-path IDs from scripts/parse_cst.py — never raw line
numbers — so edits are robust to whitespace shifts and the diff invariant
("the diff is confined to the targeted node's structural span") can be
verified after every patch.

CLI
---
    python3 cst_rewrite.py <file> replace_node <node_id>           < new_source.py
    python3 cst_rewrite.py <file> insert_before <node_id>          < new_source.py
    python3 cst_rewrite.py <file> insert_after <node_id>           < new_source.py
    python3 cst_rewrite.py <file> append_end                        < new_source.py
    python3 cst_rewrite.py <file> delete_node <node_id>
    python3 cst_rewrite.py <file> rename_in_scope <node_id> <new_name>

  M-RUN3 run-probe op (emits errorKind on failure; TEMP RUN COPIES only —
  the server never applies it to a real project file):
    python3 cst_rewrite.py <file> capture_probe <node_id> <var_name>
        Rewrites a `return <expr>` or expression statement into
        `<var> = (<expr>)` + the fixed SM1 capture probe + `raise _VGStop()`.
        No stdin: the injected text is templated inside the op, so callers
        can only choose WHERE to capture, never WHAT runs.

  M12.1 add-component ops (emit errorKind on failure — see §5.3):
    python3 cst_rewrite.py <file> insert_as_first_child <node_id>  < new_source.py
    python3 cst_rewrite.py <file> insert_as_last_child  <node_id>  < new_source.py
    python3 cst_rewrite.py <file> append_positional_arg <node_id>  < expr.py
    python3 cst_rewrite.py <file> append_keyword_arg    <node_id> <key>  < expr.py

  M16.1 signature-edit op (PLAN-v4 §4.4 — emits errorKind on failure):
    python3 cst_rewrite.py <file> add_function_parameter <node_id> <param_name>
        [--default '<expr>'] [--annotation '<expr>']
        [--position end|before:<existing_param_name>]

  M18.2 whole-scope ops (PLAN-v3-revised §A.4 — emit errorKind on failure;
  on success print {"success": true, "diff": ..., "newSource": ...}):
    python3 cst_rewrite.py <file> replace_function_body <node_id> [--allow-signature-change]  < new_function.py
    python3 cst_rewrite.py <file> replace_module_body  [<node_id>]                            < new_module.py

  PLAN-v7 4a greenfield op (emits errorKind on failure; on success prints
  {"success": true, "newSource": ...} — the whole file is the surfaced diff):
    python3 cst_rewrite.py <file> create_file                       < new_module.py
        The ONE op whose target must NOT exist: creation only, never
        overwrite (file_exists). Guards: .py suffix + parents created, no ".."
        (invalid_path), non-empty content (empty_source), content must
        parse (parse_error). Written file = black-formatted source.
        Project-root containment is the caller's (server's) guard.

Flags (after the op-args):
    --dry-run                Print result to stdout, do not write file
    --no-format              Skip running black after the patch
    --no-diff                Skip the diff-confinement check
    --allow-signature-change replace_function_body: permit signature edits
                             (set only when the def itself is the target)

Output
------
    On success: writes file (unless --dry-run); prints {"success": true} to stdout.
    On failure: prints {"success": false, "error": "..."} to stdout; file unchanged.

Pipeline
--------
    parse → build path-id → CST node map → apply op → emit source
       → format via black (SCOPED to the edited span, whole-file as
         fallback) → diff against pre-edit source
       → reject if diff escapes the targeted span → write

    M-DIRTY: black formats only the lines the op produced. Whole-file
    formatting reflowed lines far from the edit on any file that was not
    already black-clean — i.e. all real-world code — and the confinement
    check then refused every such write. Both format candidates face the
    SAME unchanged confinement check, so this admits no edit the previous
    pipeline would have rejected on merit; it only stops manufacturing
    rejections. See PLAN-M-DIRTY.md and reviews/modify-showdown-2026-08/.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Iterator, Optional

import libcst as cst
import libcst.metadata as meta

# Reuse parse_cst.GraphBuilder so structural-path IDs are computed identically
# to what the rest of the system already emits. No second source of truth.
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from parse_cst import GraphBuilder  # noqa: E402


# ── M12.1 structured op-error taxonomy ──────────────────────
#
# PLAN-v3.md §5.3 mandates a fixed errorKind taxonomy on op rejections
# so the post-drop modal can surface a useful inline message and the
# webview can branch on the kind (e.g. clear-and-retry vs. target-stale
# vs. server-bug). M12.1's new ops raise `OpError(kind, msg)`; main()
# catches it specifically and emits `{"errorKind": kind}` alongside the
# usual error string.
#
# Pre-M12.1 ops (replace_node / insert_before / insert_after / delete_node
# / append_end / rename_in_scope) keep raising raw KeyError /
# ParserSyntaxError / RuntimeError / ValueError for backward compat —
# their existing tests assert on those exception classes. The errorKind
# field is absent in their JSON output, which is fine for current
# callers (server.ts inspects "success" only).

_VALID_ERROR_KINDS = frozenset({
    "parse_error",
    "wrong_node_kind",
    "invalid_identifier",
    "diff_confinement_failed",
    "target_not_found",
    # M18.2 — op_replace_function_body's import-hoisting guard (§A.4):
    # a hoisted import with no reference in the new function body is
    # rejected rather than silently added. Additive taxonomy extension.
    "unused_import",
    # M10R — empty stdin on a source-consuming op. Without this guard an
    # empty `new_source` parses to zero statements and replace_node
    # applies it as a SILENT DELETE that passes diff confinement (a
    # deletion is within the target's span) and reports success. Caught
    # live driving the MCP rewrite tool with its then-documented payload
    # shape. Deletion must be explicit: use delete_node.
    "empty_source",
    # PLAN-v7 4a — create_file's guards (additive taxonomy extension,
    # ratified in the Stage-4 decision conversation). create_file is the
    # one op whose target must NOT exist: creation only, never overwrite
    # (creation ≠ edit — an existing file must be edited through the
    # position-targeted ops so diff confinement applies).
    "file_exists",
    # PLAN-v7 4a — path shape violations for create_file: non-.py suffix,
    # a ".." segment, or an uncreatable parent (blocked by an existing
    # non-directory). Missing parents are CREATED since 2026-08-02 —
    # traversal-free paths only, so project-root containment (the
    # SERVER's guard — this script doesn't know the root) still holds.
    "invalid_path",
})


class OpError(RuntimeError):
    """
    Structured error for M12 add-component ops. The `kind` attribute is
    one of `_VALID_ERROR_KINDS` and is what the webview branches on.

    Inherits from RuntimeError so existing tests that assert
    `with self.assertRaises(RuntimeError)` on diff-confinement /
    target-not-found failures continue to pass when the orchestrator
    translates those into OpError for the new M12.1 ops.

    Constructed as `OpError("parse_error", "expected if statement, got …")`.
    """

    def __init__(self, kind: str, msg: str, diff: Optional[str] = None) -> None:
        if kind not in _VALID_ERROR_KINDS:
            raise ValueError(
                f"OpError: invalid kind '{kind}'; expected one of {sorted(_VALID_ERROR_KINDS)}"
            )
        super().__init__(msg)
        self.kind = kind
        self.msg = msg
        # M18.2 — whole-scope ops (replace_function_body / _module_body)
        # attach the unified diff to a diff-related rejection so the panel
        # can show the user exactly which lines escaped the target span.
        self.diff = diff

    def __str__(self) -> str:
        return self.msg


# Ops whose failures emit a structured `errorKind`. Pre-M12.1 ops are
# absent from this set and keep their plain-string error shape.
# M16.1 extends the M12.1 set with `add_function_parameter`, which shares
# the same errorKind contract (PLAN-v4.md §4.4).
_M12_OPS = frozenset({
    "insert_as_first_child",
    "insert_as_last_child",
    "append_positional_arg",
    "append_keyword_arg",
    "add_function_parameter",
})

# M18.2 whole-scope ops. These run their own format-and-diff pipeline
# internally (the import-hoisting exception in §A.4 Guard 2 means the
# generic line-confinement check can't model their allowed out-of-span
# change), so the orchestrator skips steps 3 & 4 for them and they return
# already-formatted, already-confined source.
_SELF_PIPELINE_OPS = frozenset({
    "replace_function_body",
    "replace_module_body",
})


# ── helpers ──────────────────────────────────────────────────

def _build_wrapper(source: str) -> tuple[meta.MetadataWrapper, dict[str, cst.CSTNode]]:
    """
    Parse `source` and return (wrapper, {path_id → CST node from wrapper.module}).

    All downstream ops MUST use `wrapper.module` and node references from the
    returned id-map — otherwise libcst metadata lookups (Position/Scope) fail
    with KeyError because the wrapper internally re-instantiates nodes.
    """
    module = cst.parse_module(source)
    wrapper = meta.MetadataWrapper(module)
    builder = GraphBuilder(wrapper.module, capture_nodes=True)
    wrapper.visit(builder)
    return wrapper, builder.nodes_by_id


def _resolve(source: str, target_id: str) -> tuple[meta.MetadataWrapper, cst.CSTNode]:
    wrapper, m = _build_wrapper(source)
    if target_id not in m:
        raise KeyError(f"Node not found: {target_id}")
    return wrapper, m[target_id]


def _parse_stmts(src: str) -> list[cst.BaseStatement]:
    """
    Parse `src` as a sequence of statements at module scope.

    libcst attaches leading comments AT THE TOP OF A MODULE to `module.header`,
    not to the first statement's `leading_lines`. We move them into the first
    statement so callers like comment-toggle (which prepends `# TODO: …` to a
    function) preserve their leading comment when the result is spliced back
    into a containing module.

    A METHOD's source arrives indented at its class-body level — that is how
    it reads in the file, and it is what a caller naturally sends back. At
    module scope `    def __init__(...)` is a syntax error, so replacing a
    method through replace_node used to die with a bare ParserSyntaxError
    while replace_function_body (which dedents) accepted the identical text.
    Dedent here so every source-consuming op agrees; libcst re-indents the
    statements to their destination block when they are spliced in.

    textwrap.dedent removes only the COMMON leading prefix, so column-0
    source and mixed-indent blocks are untouched.
    """
    src = textwrap.dedent(src.rstrip("\n") + "\n")
    mod = cst.parse_module(src)
    body = list(mod.body)
    if mod.header and body and hasattr(body[0], "leading_lines"):
        body[0] = body[0].with_changes(
            leading_lines=tuple(mod.header) + tuple(body[0].leading_lines)
        )
    return body


def _node_pos(module: cst.Module, target: cst.CSTNode) -> dict:
    """Return {line, endLine} for `target` using PositionProvider."""
    wrapper = meta.MetadataWrapper(module)
    pos = wrapper.resolve(meta.PositionProvider)
    # The wrapper.resolve uses a fresh visit, so target identity from a stale
    # parse won't be present here. Caller passes target from the SAME module.
    p = pos[target]
    return {"line": p.start.line, "endLine": p.end.line}


# ── op: replace_node ─────────────────────────────────────────

class _ReplaceTransformer(cst.CSTTransformer):
    """Replace `target` (matched by identity) with one or more new statements."""

    def __init__(self, target: cst.CSTNode, new_stmts: list[cst.BaseStatement]) -> None:
        super().__init__()
        self._target = target
        self._new = new_stmts
        self.matched = False

    # libcst dispatches to leave_<NodeType>; do NOT override on_leave or it
    # short-circuits dispatch and these never run.

    def leave_Module(self, original, updated):
        return updated.with_changes(body=self._rebuild(original.body, updated.body))

    def leave_IndentedBlock(self, original, updated):
        return updated.with_changes(body=self._rebuild(original.body, updated.body))

    def _rebuild(self, original_body, updated_body):
        # `original_body` preserves identity to compare against `self._target`;
        # `updated_body` carries any inner-node changes from earlier passes.
        out = []
        for orig_stmt, upd_stmt in zip(original_body, updated_body):
            if self._matches(orig_stmt):
                self.matched = True
                # Preserve the target's leading_lines on the first new stmt so
                # the blank-line gap before it isn't lost. Critical for no-op
                # replace round-trips (Stage 2 byte-identity invariant).
                preserved = _transfer_leading_lines(orig_stmt, list(self._new))
                out.extend(preserved)
            else:
                out.append(upd_stmt)
        return tuple(out)

    def _matches(self, stmt) -> bool:
        # A SimpleStatementLine wraps short statements (Assign, Import, Return,
        # Raise, Expr/Call). The target may be either the wrapper or its inner
        # Assign/Import/etc.; check both.
        if stmt is self._target:
            return True
        if isinstance(stmt, cst.SimpleStatementLine):
            for inner in stmt.body:
                if inner is self._target:
                    return True
        return False


def _transfer_leading_lines(orig_stmt, new_stmts: list):
    """
    Prepend orig_stmt.leading_lines to the first of new_stmts (preserving any
    leading_lines the user supplied — e.g. comments). orig comes first so the
    blank-line gap that preceded the original statement still appears before
    the user's added comments.
    """
    if not new_stmts:
        return new_stmts
    leading = getattr(orig_stmt, "leading_lines", None)
    if not leading:
        return new_stmts
    first = new_stmts[0]
    if not hasattr(first, "leading_lines"):
        return new_stmts
    new_stmts[0] = first.with_changes(
        leading_lines=tuple(leading) + tuple(first.leading_lines)
    )
    return new_stmts


def op_replace_node(source: str, target_id: str, new_source: str) -> str:
    wrapper, target = _resolve(source, target_id)
    new_stmts = _parse_stmts(new_source)
    transformer = _ReplaceTransformer(target, new_stmts)
    new_module = wrapper.module.visit(transformer)
    if not transformer.matched:
        raise RuntimeError(f"replace_node: target body-statement not found for id; check ID validity")
    return new_module.code


# ── op: insert_before / insert_after / delete_node ───────────

class _InsertOrDeleteTransformer(cst.CSTTransformer):
    """Insert before/after `target`, or delete `target`, in its parent body."""

    def __init__(
        self,
        target: cst.CSTNode,
        new_stmts: Optional[list[cst.BaseStatement]],
        position: str,  # "before" | "after" | "delete"
    ) -> None:
        super().__init__()
        self._target = target
        self._new = new_stmts or []
        self._position = position
        self.matched = False

    def leave_Module(self, original, updated):
        return updated.with_changes(body=self._rebuild(original.body, updated.body))

    def leave_IndentedBlock(self, original, updated):
        return updated.with_changes(body=self._rebuild(original.body, updated.body))

    def _rebuild(self, original_body, updated_body):
        out = []
        # On delete, we need to forward the deleted stmt's leading_lines to
        # the next sibling so the gap before it is preserved (otherwise
        # `delete` removes both the stmt AND its leading blank lines).
        carry_leading = None
        for orig_stmt, upd_stmt in zip(original_body, updated_body):
            if carry_leading is not None and hasattr(upd_stmt, "leading_lines"):
                upd_stmt = upd_stmt.with_changes(
                    leading_lines=tuple(carry_leading) + tuple(upd_stmt.leading_lines)
                )
                carry_leading = None
            if self._matches(orig_stmt):
                self.matched = True
                if self._position == "before":
                    # New stmts inherit the target's leading_lines so they sit
                    # in the gap that the target previously occupied; clear
                    # target's own leading_lines (they've been moved).
                    new_with_leading = list(self._new)
                    if new_with_leading and hasattr(orig_stmt, "leading_lines"):
                        first = new_with_leading[0]
                        if hasattr(first, "leading_lines"):
                            new_with_leading[0] = first.with_changes(
                                leading_lines=orig_stmt.leading_lines
                            )
                            if hasattr(upd_stmt, "leading_lines"):
                                upd_stmt = upd_stmt.with_changes(leading_lines=())
                    out.extend(new_with_leading)
                    out.append(upd_stmt)
                elif self._position == "after":
                    out.append(upd_stmt)
                    out.extend(self._new)
                elif self._position == "delete":
                    if hasattr(orig_stmt, "leading_lines") and orig_stmt.leading_lines:
                        carry_leading = orig_stmt.leading_lines
            else:
                out.append(upd_stmt)
        return tuple(out)

    def _matches(self, stmt) -> bool:
        if stmt is self._target:
            return True
        if isinstance(stmt, cst.SimpleStatementLine):
            for inner in stmt.body:
                if inner is self._target:
                    return True
        return False


def op_insert_before(source: str, target_id: str, new_source: str) -> str:
    wrapper, target = _resolve(source, target_id)
    new_stmts = _parse_stmts(new_source)
    t = _InsertOrDeleteTransformer(target, new_stmts, "before")
    new_module = wrapper.module.visit(t)
    if not t.matched:
        raise RuntimeError(f"insert_before: target body-statement not found for {target_id}")
    return new_module.code


def op_insert_after(source: str, target_id: str, new_source: str) -> str:
    wrapper, target = _resolve(source, target_id)
    new_stmts = _parse_stmts(new_source)
    t = _InsertOrDeleteTransformer(target, new_stmts, "after")
    new_module = wrapper.module.visit(t)
    if not t.matched:
        raise RuntimeError(f"insert_after: target body-statement not found for {target_id}")
    return new_module.code


def op_delete_node(source: str, target_id: str) -> str:
    wrapper, target = _resolve(source, target_id)
    t = _InsertOrDeleteTransformer(target, None, "delete")
    new_module = wrapper.module.visit(t)
    if not t.matched:
        raise RuntimeError(f"delete_node: target body-statement not found for {target_id}")
    return new_module.code


# ── op: capture_probe (M-RUN3) ───────────────────────────────
# Run-to-here's SM1 probe reads a NAMED variable after an assignment — but a
# `return expr` or a bare call statement produces its value anonymously. This
# op rewrites such a statement IN THE RUN'S TEMP COPY ONLY into:
#
#     <var> = (<expr>)                      # the capture point — value is REAL,
#     print("__VG__::" + json.dumps(repr(<var>)))   # only the holding name is
#     raise _VGStop()                       # synthetic
#
# The repr is JSON-encoded so it occupies exactly one stdout line: run_to_node's
# marker scan is line-based, and a multi-line repr (every torch.nn.Module has
# one) was otherwise silently cut to its first line. Keep in sync with the two
# probe strings in server.ts and with run_to_node._decode_capture.
#
# The expression source comes from the CST printer (code_for_node), never from
# line slicing. Accepted targets: Return-with-value, expression statement
# (`x.call` ids resolve to cst.Expr). Everything else is wrong_node_kind —
# the client should not have offered the affordance. Runs the full
# format-and-diff pipeline like every positional op.

_CAPTURE_PROBE_TEMPLATE = (
    "{var} = ({expr})\n"
    'print("__VG__::" + __import__("json").dumps(repr({var})))\n'
    "raise _VGStop()"
)


def op_capture_probe(source: str, target_id: str, var_name: str) -> str:
    if not _IDENTIFIER_RE.match(var_name):
        raise OpError(
            "invalid_identifier",
            f"capture_probe: capture variable must be a plain identifier (got: {var_name!r})",
        )
    try:
        wrapper, target = _resolve(source, target_id)
    except KeyError as e:
        raise OpError("target_not_found", str(e)) from e

    if isinstance(target, cst.Return):
        if target.value is None:
            raise OpError(
                "wrong_node_kind",
                "capture_probe: bare `return` has no value to capture",
            )
        expr = target.value
    elif isinstance(target, cst.Expr):
        expr = target.value
    else:
        raise OpError(
            "wrong_node_kind",
            f"capture_probe: cannot capture a value from {type(target).__name__} "
            "(expected a return statement or an expression statement)",
        )

    # Guard: replacing the whole SimpleStatementLine must not drop siblings on
    # a semicolon-joined line (`a(); return b`). Rare, but silent loss is worse.
    class _LineFinder(cst.CSTVisitor):
        def __init__(self) -> None:
            self.line: Optional[cst.SimpleStatementLine] = None

        def visit_SimpleStatementLine(self, node: cst.SimpleStatementLine) -> None:
            if any(inner is target for inner in node.body):
                self.line = node

    finder = _LineFinder()
    wrapper.module.visit(finder)
    if finder.line is not None and len(finder.line.body) > 1:
        raise OpError(
            "wrong_node_kind",
            "capture_probe: target shares a semicolon-joined line with other "
            "statements — capturing would drop them",
        )

    expr_src = wrapper.module.code_for_node(expr).strip()
    block = _CAPTURE_PROBE_TEMPLATE.format(var=var_name, expr=expr_src)
    new_stmts = _parse_stmts(block)
    t = _ReplaceTransformer(target, new_stmts)
    new_module = wrapper.module.visit(t)
    if not t.matched:
        raise OpError("target_not_found", f"capture_probe: target body-statement not found for {target_id}")
    return new_module.code


def op_append_end(source: str, new_source: str) -> str:
    """Append new_stmts to the module body (no anchor node)."""
    module = cst.parse_module(source)
    new_stmts = _parse_stmts(new_source)
    new_module = module.with_changes(body=tuple(list(module.body) + new_stmts))
    return new_module.code


# ── op: create_file (PLAN-v7 Stage 4a) ───────────────────────

def op_create_file(new_source: str, do_format: bool = True) -> str:
    """
    Validate + format the content of a BRAND-NEW module (greenfield build
    increments). There is no pre-edit source, so the M2 diff-confinement
    check has nothing to diff against; the confinement analogue is the
    guard set main() enforces before calling here:
      - the target path must NOT exist (creation only, never overwrite —
        editing an existing file must go through the position-targeted
        ops so real diff confinement applies);
      - .py suffix, no ".." segments; missing parent dirs are created
        (traversal-free, so caller-side root containment holds);
      - non-empty content (the M10R empty_source guard).
    The entire file IS the surfaced diff: dry-run prints it, and the wet
    success JSON carries it as newSource so the human gate renders exactly
    what was written. Content must parse; the written file is exactly the
    black-formatted source.
    """
    try:
        cst.parse_module(new_source)
    except Exception as e:
        raise OpError("parse_error", f"create_file: content does not parse: {e}") from e
    return _run_black(new_source) if do_format else new_source


# ── op: rename_in_scope ──────────────────────────────────────

def _scope_of(target: cst.CSTNode) -> str:
    """
    Return the IR's scope-kind for the target's defining scope.
    Unused at runtime — kept as documentation; libcst's ScopeProvider does
    the real work below.
    """
    return type(target).__name__


class _RenameTransformer(cst.CSTTransformer):
    """
    Scope-aware rename. Replace `cst.Name(value=old)` with `cst.Name(value=new)`
    only at access/assignment sites that resolve into the same Scope as the
    original definition.

    Skips:
        * shadowed inner scopes (libcst's ScopeProvider gives each name its
          enclosing scope; only matches with scope == def-scope are renamed)
        * Attribute access (`obj.old` is left alone — that's a different
          symbol on a different object)
        * Strings, comments, decorators-as-strings, dotted import names

    Honoured forms:
        * `old` as a bare name reference                  → `new`
        * `def old(...)`                                  → `def new(...)`
        * `class old(...)`                                → `class new(...)`
        * `old = ...` assignment target                   → `new = ...`
        * `for old in ...` loop var (rare)                → `for new in ...`
    """

    METADATA_DEPENDENCIES = (meta.ScopeProvider, meta.ParentNodeProvider)

    def __init__(self, def_scope, old_name: str, new_name: str) -> None:
        super().__init__()
        self._def_scope = def_scope
        self._old = old_name
        self._new = new_name
        self.replacements = 0

    def leave_Name(self, original, updated):
        if original.value != self._old:
            return updated
        try:
            scope = self.get_metadata(meta.ScopeProvider, original)
        except KeyError:
            return updated
        if scope is None:
            return updated
        # Lexical scope walk: find the first scope that *directly* binds old_name
        # (libcst's `name in scope` is chain-aware, so we have to inspect
        # `scope.assignments` for direct matches).
        #   * binds directly in def_scope → this use resolves to the target → rename
        #   * binds directly in a closer scope → shadowed → skip
        #   * binds nowhere → free name (e.g. builtin) → skip
        cur = scope
        while cur is not None:
            if any(a.name == self._old for a in cur.assignments):
                if cur is self._def_scope:
                    self.replacements += 1
                    return updated.with_changes(value=self._new)
                return updated  # shadowed
            cur = cur.parent
        return updated


def _find_def_scope(wrapper: meta.MetadataWrapper, target: cst.CSTNode):
    """Return the Scope in which `target` introduces its name."""
    scopes = wrapper.resolve(meta.ScopeProvider)
    sc = scopes.get(target)
    if sc is None:
        # Fallback: walk up via parent provider until a scoped node is found.
        parents = wrapper.resolve(meta.ParentNodeProvider)
        cur = parents.get(target)
        while cur is not None:
            sc = scopes.get(cur)
            if sc is not None:
                break
            cur = parents.get(cur)
    return sc


def op_rename_in_scope(source: str, target_id: str, new_name: str) -> str:
    wrapper, target = _resolve(source, target_id)

    # Extract the old name from the target node based on its kind.
    old_name: Optional[str] = None
    if isinstance(target, (cst.FunctionDef, cst.ClassDef)):
        old_name = target.name.value
    elif isinstance(target, cst.Assign):
        # First simple-name target only (multi-target assignments rejected)
        if not target.targets:
            raise ValueError("rename_in_scope: assignment has no targets")
        first = target.targets[0].target
        if isinstance(first, cst.Name):
            old_name = first.value
        else:
            raise ValueError(
                "rename_in_scope: assignment target is not a simple name "
                f"(got {type(first).__name__}); rename the underlying symbol via its def node"
            )
    elif isinstance(target, cst.Param):
        old_name = target.name.value
    else:
        raise ValueError(
            f"rename_in_scope: cannot rename node of type {type(target).__name__}; "
            "supported defs: function_def, class_def, assignment"
        )

    if not new_name.isidentifier():
        raise ValueError(f"rename_in_scope: '{new_name}' is not a valid Python identifier")

    def_scope = _find_def_scope(wrapper, target)
    if def_scope is None:
        raise RuntimeError("rename_in_scope: could not resolve defining scope for target")

    transformer = _RenameTransformer(def_scope, old_name, new_name)
    new_module = wrapper.visit(transformer)
    if transformer.replacements == 0:
        # Defensive: the def itself should always match. If we got here, the
        # ScopeProvider gave us a scope identity that didn't match anything.
        raise RuntimeError(
            f"rename_in_scope: no occurrences of '{old_name}' found in the target's scope; "
            "this is a bug — at minimum the definition itself should rename"
        )
    return new_module.code


# ── M12.1 add-component ops (insert_as_first/last_child, append_*_arg) ─
#
# These four ops back PLAN-v3.md §5.2. Unlike the pre-existing ops, they
# raise OpError on failure so the post-drop modal can branch on
# errorKind (§5.3). They reuse `_resolve` / `_parse_stmts` and the
# existing diff-confinement orchestrator in apply() — no parallel
# verification path.

# Body-bearing CST node types accepted by op_insert_as_first/last_child.
# These are the only kinds with a `.body: IndentedBlock` slot that we
# support inserting into in Merge B. Try/With deferred — they have
# `.body` but also `.handlers` / `.items` which complicate the "which
# block?" question; PLAN-v3.md §3.1 keeps the v1 vocabulary to the five
# unambiguous kinds. If/elif-chain: only the first IfBody is targeted;
# else-branch insertion needs a separate op (out of scope for M12.1).
_BODY_BEARING_TYPES = (
    cst.FunctionDef,
    cst.ClassDef,
    cst.For,
    cst.While,
    cst.If,
)


def _resolve_or_op_error(source: str, target_id: str) -> tuple[meta.MetadataWrapper, cst.CSTNode]:
    """`_resolve` wrapper that translates KeyError → OpError(target_not_found)."""
    try:
        return _resolve(source, target_id)
    except KeyError as e:
        raise OpError("target_not_found", str(e)) from e


def _parse_stmts_or_op_error(new_source: str, op_label: str) -> list[cst.BaseStatement]:
    """`_parse_stmts` wrapper that translates ParserSyntaxError → OpError(parse_error)."""
    try:
        return _parse_stmts(new_source)
    except cst.ParserSyntaxError as e:
        raise OpError("parse_error", f"{op_label}: source is invalid Python: {e}") from e


def _parse_expression_or_op_error(expr_source: str, op_label: str) -> cst.BaseExpression:
    """`cst.parse_expression` wrapper that translates ParserSyntaxError → OpError(parse_error)."""
    try:
        return cst.parse_expression(expr_source.strip())
    except cst.ParserSyntaxError as e:
        raise OpError("parse_error", f"{op_label}: expression is invalid Python: {e}") from e


def _find_call_in_target(target: cst.CSTNode) -> Optional[cst.Call]:
    """
    Unwrap the IR's statement-level call indirection.

    A target_id may resolve to one of:
      - `cst.Call` directly (call as an expression-level node)
      - `cst.Expr` wrapping `cst.Call` (statement-level bare call)
      - `cst.Assign` / `cst.AnnAssign` whose value is a `cst.Call`
        (e.g. `create = sub.add_parser("create")`) — M18.5 needs this so
        "add an argument to the create subparser" can target the
        assignment node and reach the add_parser call on its RHS
      - `cst.SimpleStatementLine` wrapping any of the above

    Returns the inner Call node, or None if the target isn't call-shaped.
    """
    if isinstance(target, cst.Call):
        return target
    if isinstance(target, cst.Expr) and isinstance(target.value, cst.Call):
        return target.value
    if isinstance(target, (cst.Assign, cst.AnnAssign)) and isinstance(target.value, cst.Call):
        return target.value
    if isinstance(target, cst.SimpleStatementLine):
        for inner in target.body:
            if isinstance(inner, cst.Expr) and isinstance(inner.value, cst.Call):
                return inner.value
            if isinstance(inner, (cst.Assign, cst.AnnAssign)) and isinstance(inner.value, cst.Call):
                return inner.value
    return None


class _AppendArgTransformer(cst.CSTTransformer):
    """Append `new_args` to the args list of `target_call` (matched by identity)."""

    def __init__(self, target_call: cst.Call, new_args: list[cst.Arg]) -> None:
        super().__init__()
        self._target = target_call
        self._new_args = new_args
        self.matched = False

    def leave_Call(self, original, updated):
        if original is self._target:
            self.matched = True
            return updated.with_changes(args=tuple(list(updated.args) + list(self._new_args)))
        return updated


def _insert_into_body(
    source: str,
    target_id: str,
    new_source: str,
    position: str,   # "first" | "last"
    op_label: str,
) -> str:
    """Shared core for op_insert_as_first_child / op_insert_as_last_child."""
    wrapper, target = _resolve_or_op_error(source, target_id)
    if not isinstance(target, _BODY_BEARING_TYPES):
        raise OpError(
            "wrong_node_kind",
            f"{op_label}: target must be a body-bearing node "
            f"(function_def / class_def / for_loop / while_loop / if_stmt); "
            f"got {type(target).__name__}",
        )
    body = target.body
    if not isinstance(body, cst.IndentedBlock):
        raise OpError(
            "wrong_node_kind",
            f"{op_label}: target.body is not an IndentedBlock (got {type(body).__name__})",
        )
    new_stmts = _parse_stmts_or_op_error(new_source, op_label)

    if position == "first":
        new_body_stmts = tuple(new_stmts) + tuple(body.body)
    elif position == "last":
        new_body_stmts = tuple(body.body) + tuple(new_stmts)
    else:
        raise ValueError(f"_insert_into_body: invalid position '{position}'")

    new_indented = body.with_changes(body=new_body_stmts)
    modified_target = target.with_changes(body=new_indented)

    transformer = _ReplaceTransformer(target, [modified_target])
    new_module = wrapper.module.visit(transformer)
    if not transformer.matched:
        # Defensive: target was found by _resolve but the transformer didn't
        # match it. Indicates the parent of `target` is neither Module nor an
        # IndentedBlock — possible if target is itself nested inside e.g. an
        # `if`'s OrElse. M12.1 doesn't claim to handle that; surface clearly.
        raise OpError(
            "target_not_found",
            f"{op_label}: target resolved but its containing body was not "
            f"reached by the rewriter (target is likely inside an unsupported "
            f"context such as an else-branch or try/finally clause)",
        )
    return new_module.code


def op_insert_as_first_child(source: str, target_id: str, new_source: str) -> str:
    """Insert `new_source` as the first statement of `target_id`'s body."""
    return _insert_into_body(source, target_id, new_source, "first", "insert_as_first_child")


def op_insert_as_last_child(source: str, target_id: str, new_source: str) -> str:
    """Insert `new_source` as the last statement of `target_id`'s body."""
    return _insert_into_body(source, target_id, new_source, "last", "insert_as_last_child")


def op_append_positional_arg(source: str, target_id: str, expr_source: str) -> str:
    """Append a new positional arg `expr_source` to the call at `target_id`."""
    wrapper, target = _resolve_or_op_error(source, target_id)
    call_node = _find_call_in_target(target)
    if call_node is None:
        raise OpError(
            "wrong_node_kind",
            f"append_positional_arg: target is not a call "
            f"(got {type(target).__name__})",
        )
    expr = _parse_expression_or_op_error(expr_source, "append_positional_arg")
    new_arg = cst.Arg(value=expr)

    transformer = _AppendArgTransformer(call_node, [new_arg])
    new_module = wrapper.module.visit(transformer)
    if not transformer.matched:
        raise OpError(
            "target_not_found",
            f"append_positional_arg: call node resolved but was not "
            f"reached by the rewriter (internal inconsistency)",
        )
    return new_module.code


# Python identifier per the language reference (excluding non-ASCII).
# Same shape as PLAN-v3.md §5.3.
_IDENTIFIER_RE = __import__("re").compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def op_append_keyword_arg(
    source: str,
    target_id: str,
    key: str,
    expr_source: str,
) -> str:
    """Append a new keyword arg `key=expr_source` to the call at `target_id`."""
    wrapper, target = _resolve_or_op_error(source, target_id)
    call_node = _find_call_in_target(target)
    if call_node is None:
        raise OpError(
            "wrong_node_kind",
            f"append_keyword_arg: target is not a call "
            f"(got {type(target).__name__})",
        )
    if not _IDENTIFIER_RE.match(key):
        raise OpError(
            "invalid_identifier",
            f"append_keyword_arg: '{key}' is not a valid Python identifier",
        )
    expr = _parse_expression_or_op_error(expr_source, "append_keyword_arg")
    new_arg = cst.Arg(
        value=expr,
        keyword=cst.Name(key),
        equal=cst.AssignEqual(
            whitespace_before=cst.SimpleWhitespace(""),
            whitespace_after=cst.SimpleWhitespace(""),
        ),
    )

    transformer = _AppendArgTransformer(call_node, [new_arg])
    new_module = wrapper.module.visit(transformer)
    if not transformer.matched:
        raise OpError(
            "target_not_found",
            f"append_keyword_arg: call node resolved but was not "
            f"reached by the rewriter (internal inconsistency)",
        )
    return new_module.code


# ── M16.1: op_add_function_parameter ─────────────────────────
#
# PLAN-v4.md §4.4: adds a parameter to a function_def's signature.
# Drives the "Add to enclosing function" affordance in the M16.4
# ArgumentEditorPanel — when the user introduces a new call whose target
# expects an argument that doesn't yet exist as a local/in-scope name,
# they can plumb it through the enclosing function in one step.
#
# Position is either "end" (default — append) or "before:<name>" (insert
# before the named existing param). Anchor-name not present in the
# signature → target_not_found; missing function_def → target_not_found.

def op_add_function_parameter(
    source: str,
    target_id: str,
    param_name: str,
    default_value: Optional[str] = None,
    type_annotation: Optional[str] = None,
    position: str = "end",
) -> str:
    """Add `param_name` to `target_id`'s function signature."""
    wrapper, target = _resolve_or_op_error(source, target_id)
    if not isinstance(target, cst.FunctionDef):
        raise OpError(
            "wrong_node_kind",
            f"add_function_parameter: target must be a function_def "
            f"(got {type(target).__name__})",
        )
    if not _IDENTIFIER_RE.match(param_name):
        raise OpError(
            "invalid_identifier",
            f"add_function_parameter: '{param_name}' is not a valid Python identifier",
        )

    default_expr = None
    if default_value is not None:
        default_expr = _parse_expression_or_op_error(
            default_value, "add_function_parameter (default)"
        )
    annotation_node = None
    if type_annotation is not None:
        ann_expr = _parse_expression_or_op_error(
            type_annotation, "add_function_parameter (annotation)"
        )
        annotation_node = cst.Annotation(annotation=ann_expr)

    new_param = cst.Param(
        name=cst.Name(param_name),
        annotation=annotation_node,
        default=default_expr,
    )

    params = target.params
    existing = list(params.params)

    if position == "end":
        new_params_list = existing + [new_param]
    elif position.startswith("before:"):
        anchor_name = position[len("before:"):]
        idx = None
        for i, p in enumerate(existing):
            if p.name.value == anchor_name:
                idx = i
                break
        if idx is None:
            raise OpError(
                "target_not_found",
                f"add_function_parameter: anchor param '{anchor_name}' "
                f"not found in {target.name.value}()",
            )
        new_params_list = existing[:idx] + [new_param] + existing[idx:]
    else:
        # Programmer error from a calling layer; surfaced as target_not_found
        # (closest taxonomy match — the requested position can't be resolved).
        raise OpError(
            "target_not_found",
            f"add_function_parameter: position must be 'end' or "
            f"'before:<existing_param_name>'; got {position!r}",
        )

    # Normalize commas so libcst's auto-insertion stays correct after the
    # last-position changes. DEFAULT sentinel lets libcst pick "comma if not
    # last, none if last".
    normalized = [p.with_changes(comma=cst.MaybeSentinel.DEFAULT) for p in new_params_list]
    new_params_obj = params.with_changes(params=tuple(normalized))
    modified_target = target.with_changes(params=new_params_obj)

    transformer = _ReplaceTransformer(target, [modified_target])
    new_module = wrapper.module.visit(transformer)
    if not transformer.matched:
        raise OpError(
            "target_not_found",
            f"add_function_parameter: function_def resolved but was not "
            f"reached by the rewriter (target is likely inside an "
            f"unsupported context such as a conditional branch)",
        )
    return new_module.code


# ── format-and-diff verification ─────────────────────────────

def _run_black(source: str, line_ranges: Optional[list[tuple[int, int]]] = None) -> str:
    """
    Format `source` with `black --quiet --fast -`.

    On non-zero exit, raises RuntimeError with stderr. On success, returns
    formatted source.

    `line_ranges` (M-DIRTY) restricts formatting to the given 1-indexed
    inclusive line ranges of `source` via `--line-ranges` (black >= 24;
    pinned in requirements.txt). Lines outside every range come out
    byte-identical.

    Why it matters: whole-file black on a file that is not already
    black-clean normalises lines far from the edit, and the downstream
    confinement check then — correctly — rejects the write. That made
    EVERY op on real-world (non-black-clean) code fail with
    diff_confinement_failed; see reviews/modify-showdown-2026-08/. Passing
    the edited span narrows black to the lines the op actually produced,
    so the confinement check keeps its exact pre-edit baseline and no
    longer sees phantom churn. The check itself is unchanged: a genuine
    out-of-span mutation is still rejected.

    Whole-file mode (no ranges) is retained for callers with no pre-edit
    source to protect — `create_file`, `_signature_repr`.
    """
    argv = [sys.executable, "-m", "black", "--quiet", "--fast"]
    for start, end in line_ranges or []:
        argv += ["--line-ranges", f"{start}-{end}"]
    argv.append("-")
    proc = subprocess.run(
        argv,
        input=source.encode("utf-8"),
        capture_output=True,
        timeout=10,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"black formatting failed (exit {proc.returncode}): "
            f"{proc.stderr.decode('utf-8', errors='replace')}"
        )
    return proc.stdout.decode("utf-8")


def _edited_line_ranges(
    pre: str,
    post: str,
    op: str,
    target_span: Optional[tuple[int, int]],
) -> Optional[list[tuple[int, int]]]:
    """
    M-DIRTY — the 1-indexed inclusive line range of `post` that the op just
    produced, for `_run_black(line_ranges=...)`.

    libcst re-emits untouched nodes byte-identically, so a position-targeted
    op changes `post` only at its target: the whole line-count delta belongs
    to the edited region. That makes the new span pure arithmetic on the
    pre-edit span the orchestrator already resolved — no re-parse.

    Returns None to mean "format the whole file" (ops with no single target
    span), and [] to mean "nothing new to format" (a deletion adds no text).
    """
    delta = len(post.splitlines()) - len(pre.splitlines())

    if op == "append_end":
        # The appended text is everything past the original last line.
        start = len(pre.splitlines()) + 1
        end = len(post.splitlines())
        return [(start, end)] if end >= start else []

    if target_span is None:
        return None

    line0, line1 = target_span
    if op == "delete_node":
        # Removal introduces no new text; the surviving lines are already
        # formatted as they were. Nothing to hand black.
        return []

    end = line1 + delta
    if end < line0:
        return []
    # Clamp to the file: black tolerates over-long ranges, but an honest
    # range keeps the surfaced intent readable.
    return [(line0, min(end, len(post.splitlines())))]


def _format_candidates(
    out: str,
    ranges: Optional[list[tuple[int, int]]],
    do_format: bool,
) -> Iterator[str]:
    """
    M-DIRTY — the formatted outputs to try, best first, each of which must
    still pass the UNCHANGED confinement check before anything is written.

    1. Span-scoped black (the M-DIRTY win): a file that was never
       black-clean keeps its pre-existing formatting outside the edit, so
       whole-file normalisation can no longer manufacture a rejection.
    2. Whole-file black — today's exact behaviour, kept as a fallback.

    Two candidates rather than one because `--line-ranges` has a narrow
    but real artifact: when a range ends at the last statement of the
    module's leading import block, black rewrites the blank run *after*
    the range (it applies "one blank line after imports" without seeing
    the def that follows). Falling back to whole-file formatting makes
    this strictly never-worse than the pre-M-DIRTY pipeline: whatever
    today's pipeline would have accepted is still offered and still
    checked. Trying two formatter configurations weakens nothing — the
    confinement check is the safety property, and only a candidate that
    passes it is ever written.

    3. UNFORMATTED — the op's own output, black never run.

    Candidate 3 is the one that makes a refusal recoverable. `--line-ranges`
    confines black's CODE formatting but NOT its file-wide normalisations:
    whatever range it is given, black strips trailing whitespace, collapses
    blank runs, and normalises comment spacing (`#x` → `# x`) across the
    whole file. Those distant edits are what trip the confinement check —
    the op itself never touched those lines. Dropping black removes the
    only thing that was writing outside the target, so libcst's
    byte-identical emission makes the head and tail trivially match.

    Measured on 200 real published packages: 13 of 13 residual refusals
    land as candidate 3, taking false refusals from 6.5% to ~0 — with the
    confinement check unchanged and still enforced on every candidate.
    The cost is cosmetic and must be disclosed by the caller: THIS edit is
    not reformatted (offer black-over-the-file as a separate, reviewable
    formatting-only change). It is ordered last so a formatted result is
    always preferred when one passes.

    Safety note: candidate 3 relaxes FORMATTING, never verification. If
    the op damaged something outside the target, that damage is present in
    the unformatted output too and is still rejected — which is why this
    is not an escape hatch in the `--no-diff` sense. It is the reason the
    chat can be denied raw file-write tools without turning a refusal into
    a dead end (the agent used to route around refusals with `Edit`,
    silently leaving the CST path entirely).

    Lazy: each fallback costs its work only when the prior candidate is
    actually rejected.
    """
    if not do_format:
        yield out
        return
    scoped: Optional[str] = None
    if ranges:
        scoped = _run_black(out, ranges)
        yield scoped
    whole = _run_black(out)
    if whole != scoped:
        yield whole
    if out != whole and out != scoped:
        yield out


def _stmt_line_ranges(
    module: cst.Module,
    stmts: list[cst.BaseStatement],
) -> list[tuple[int, int]]:
    """
    M-DIRTY — 1-indexed inclusive line ranges of `stmts` within `module`.

    Used to hand black the hoisted-import lines of `replace_function_body`.
    `unsafe_skip_copy=True` is required: the default deep-copies the tree,
    which would break the node identity these lookups rely on.
    """
    if not stmts:
        return []
    pos = meta.MetadataWrapper(module, unsafe_skip_copy=True).resolve(meta.PositionProvider)
    ranges: list[tuple[int, int]] = []
    for stmt in stmts:
        p = pos.get(stmt)
        if p is not None:
            ranges.append((p.start.line, p.end.line))
    return ranges


def _verify_diff_confined(
    pre: str,
    post: str,
    target_pre: tuple[int, int],
    op: str,
) -> None:
    """
    Verify that the diff between `pre` and `post` is confined to the target's
    structural span — i.e. lines outside `[target_pre.line - 1 .. target_pre.endLine - 1]`
    in `pre` are byte-identical (modulo right-strip) to their counterparts in
    `post`.

    For inserts/replaces, post may have more or fewer lines in the target zone;
    we anchor the check on the unchanged head and tail.

    Raises RuntimeError if the diff escapes the target span.

    Skipped entirely for `rename_in_scope` (rename can legitimately touch
    every reference site in the scope, which spans the whole file in the
    common module-scope case). Diff-confinement applies to localised ops only.
    """
    if op == "rename_in_scope":
        return  # see docstring; rename is intentionally non-local
    if op == "append_end":
        # Append-only: the entire pre source must appear unchanged at the
        # start of post (after black). Allow trailing-whitespace normalisation.
        pre_lines = [l.rstrip() for l in pre.splitlines()]
        post_lines = [l.rstrip() for l in post.splitlines()]
        if post_lines[: len(pre_lines)] != pre_lines:
            raise RuntimeError(
                "append_end: black or rewriter modified content outside the appended span"
            )
        return

    pre_lines = pre.splitlines()
    post_lines = post.splitlines()
    line0, line1 = target_pre  # 1-indexed inclusive

    head_pre = [l.rstrip() for l in pre_lines[: line0 - 1]]
    tail_pre = [l.rstrip() for l in pre_lines[line1:]]

    # Both sides are right-stripped, matching the tail comparison below and
    # the append_end branch above (and this function's documented "modulo
    # right-strip" contract). The head compare used to rstrip only the PRE
    # side; whole-file black hid the asymmetry by stripping trailing
    # whitespace across the file, so post was already clean. With black
    # scoped to the edited span (M-DIRTY), pre-existing trailing whitespace
    # OUTSIDE the target correctly survives — and would otherwise be read
    # as an escape. Trailing whitespace carries no semantics; this tolerates
    # no code change the tail comparison did not already tolerate.
    if [l.rstrip() for l in post_lines[: len(head_pre)]] != head_pre:
        # Use difflib for a precise complaint
        diff = list(difflib.unified_diff(
            pre_lines[: line0 - 1], post_lines[: len(head_pre)],
            fromfile="pre[head]", tofile="post[head]", lineterm="",
        ))
        raise RuntimeError(
            "diff escapes target span (head changed): "
            + ("\n".join(diff[:30]) if diff else "head mismatch")
        )

    if tail_pre:
        post_tail = [l.rstrip() for l in post_lines[-len(tail_pre):]]
        if post_tail != tail_pre:
            diff = list(difflib.unified_diff(
                pre_lines[line1:], post_lines[-len(tail_pre):],
                fromfile="pre[tail]", tofile="post[tail]", lineterm="",
            ))
            raise RuntimeError(
                "diff escapes target span (tail changed): "
                + ("\n".join(diff[:30]) if diff else "tail mismatch")
            )


# ── M18.2: whole-scope replace ops ───────────────────────────
#
# op_replace_function_body / op_replace_module_body back Mode A's
# "edit the whole function, commit on save" semantics (PLAN-v3-revised
# §A.4). Existing ops are position-targeted; these replace a whole scope.
# Because that widens the diff surface, three guards apply (see §A.4):
#   1. format-and-diff confinement (the diff must stay inside the
#      function's span, surfaced to the caller either way);
#   2. import-hoisting — the one permitted out-of-span change, itself
#      validated (used / placed-in-block / not-duplicated);
#   3. Mode-B human-approval gate — a UI concern (M18.5), enabled here by
#      always returning the unified diff so the panel can confirm.


def _render(node: cst.CSTNode) -> str:
    """Render a single statement node back to source (for error messages)."""
    try:
        return cst.Module(body=[node]).code
    except Exception:
        return "<node>"


def _dotted(node: cst.CSTNode) -> Optional[str]:
    """Flatten a dotted name (Name / Attribute) to 'a.b.c'; None otherwise."""
    if isinstance(node, cst.Name):
        return node.value
    if isinstance(node, cst.Attribute):
        base = _dotted(node.value)
        return f"{base}.{node.attr.value}" if base else None
    return None


def _is_import_stmt(stmt: cst.CSTNode) -> bool:
    """True for a SimpleStatementLine whose body holds an Import/ImportFrom."""
    if not isinstance(stmt, cst.SimpleStatementLine):
        return False
    return any(isinstance(b, (cst.Import, cst.ImportFrom)) for b in stmt.body)


def _is_docstring(stmt: cst.CSTNode) -> bool:
    if not isinstance(stmt, cst.SimpleStatementLine):
        return False
    return (
        len(stmt.body) == 1
        and isinstance(stmt.body[0], cst.Expr)
        and isinstance(stmt.body[0].value, (cst.SimpleString, cst.ConcatenatedString))
    )


def _import_dedupe_keys(stmt: cst.SimpleStatementLine) -> frozenset[str]:
    """
    Normalised keys identifying what a (possibly compound) import binds, for
    duplicate detection. `import a.b as c` → {'import::a.b::c'};
    `from x import y, z` → {'from::x::y::', 'from::x::z::'};
    `from x import *` → {'from::x::*'}.
    """
    keys: set[str] = set()
    for b in stmt.body:
        if isinstance(b, cst.Import):
            for alias in b.names:
                full = _dotted(alias.name) or "?"
                asn = alias.asname.name.value if isinstance(alias.asname, cst.AsName) and isinstance(alias.asname.name, cst.Name) else ""
                keys.add(f"import::{full}::{asn}")
        elif isinstance(b, cst.ImportFrom):
            mod = _dotted(b.module) if b.module is not None else ""
            dots = "." * len(b.relative)
            modkey = f"{dots}{mod or ''}"
            if isinstance(b.names, cst.ImportStar):
                keys.add(f"from::{modkey}::*")
            else:
                for alias in b.names:
                    sym = _dotted(alias.name) or "?"
                    asn = alias.asname.name.value if isinstance(alias.asname, cst.AsName) and isinstance(alias.asname.name, cst.Name) else ""
                    keys.add(f"from::{modkey}::{sym}::{asn}")
    return frozenset(keys)


def _import_bound_names(stmt: cst.SimpleStatementLine) -> list[str]:
    """
    Names this import binds into scope (for the used-in-body check).
    `import a.b` binds 'a'; `import a.b as c` binds 'c';
    `from x import y` binds 'y'; `from x import y as z` binds 'z'.
    Star imports bind nothing trackable → [].
    """
    names: list[str] = []
    for b in stmt.body:
        if isinstance(b, cst.Import):
            for alias in b.names:
                if isinstance(alias.asname, cst.AsName) and isinstance(alias.asname.name, cst.Name):
                    names.append(alias.asname.name.value)
                else:
                    full = _dotted(alias.name) or ""
                    if full:
                        names.append(full.split(".")[0])
        elif isinstance(b, cst.ImportFrom) and not isinstance(b.names, cst.ImportStar):
            for alias in b.names:
                if isinstance(alias.asname, cst.AsName) and isinstance(alias.asname.name, cst.Name):
                    names.append(alias.asname.name.value)
                else:
                    sym = _dotted(alias.name)
                    if sym:
                        names.append(sym.split(".")[0])
    return names


class _NameCollector(cst.CSTVisitor):
    def __init__(self) -> None:
        self.names: set[str] = set()

    def visit_Name(self, node: cst.Name) -> None:
        self.names.add(node.value)


def _collect_names(node: cst.CSTNode) -> set[str]:
    c = _NameCollector()
    node.visit(c)
    return c.names


def _collect_module_import_keys(module: cst.Module) -> frozenset[str]:
    keys: set[str] = set()
    for stmt in module.body:
        if _is_import_stmt(stmt):
            keys |= _import_dedupe_keys(stmt)
    return frozenset(keys)


def _insert_imports_into_block(
    body: list[cst.BaseStatement],
    imports: list[cst.BaseStatement],
) -> list[cst.BaseStatement]:
    """
    Insert `imports` into a module body's top import block — after the
    module docstring (if any) and the contiguous run of leading imports,
    before the first other statement. Returns a new body list.
    """
    if not imports:
        return body
    idx = 0
    n = len(body)
    if n > 0 and _is_docstring(body[0]):
        idx = 1
    while idx < n and _is_import_stmt(body[idx]):
        idx += 1
    return body[:idx] + imports + body[idx:]


def _signature_repr(func: cst.FunctionDef, do_format: bool) -> str:
    """
    Black-normalised rendering of a function's signature (decorators, name,
    params, return annotation) with its body collapsed to `pass`. Two
    functions share a signature iff these strings match. Used for the
    signature-parity guard.
    """
    sig = func.with_changes(
        body=cst.IndentedBlock(body=[cst.SimpleStatementLine([cst.Pass()])]),
        leading_lines=(),
    )
    code = cst.Module(body=[sig]).code
    return _run_black(code) if do_format else code


def _unified_diff(pre: str, post: str) -> str:
    return "".join(
        difflib.unified_diff(
            pre.splitlines(keepends=True),
            post.splitlines(keepends=True),
            fromfile="a", tofile="b",
        )
    )


def op_replace_function_body(
    source: str,
    target_id: str,
    new_source: str,
    allow_signature_change: bool = False,
    do_format: bool = True,
    do_diff_check: bool = True,
    report: Optional[dict] = None,
) -> str:
    """
    Replace the function at `target_id` wholesale with `new_source` (which
    must parse as exactly one function definition). See §A.4 for the guards.
    """
    wrapper, target = _resolve_or_op_error(source, target_id)
    if not isinstance(target, cst.FunctionDef):
        raise OpError(
            "wrong_node_kind",
            f"replace_function_body: target must be a function_def "
            f"(got {type(target).__name__})",
        )

    # A METHOD's source arrives indented at its class-body level (the editor
    # slices raw file lines), so `    def forward(...)` is invalid at module
    # scope and would fail to parse. Strip the common leading indent so the
    # def sits at column 0; libcst re-indents it to the target's level when it
    # replaces the node in the enclosing IndentedBlock. A no-op for a
    # top-level function (already column 0). textwrap.dedent is the standard,
    # docstring-aware common-prefix strip.
    new_source = textwrap.dedent(new_source)
    stmts = _parse_stmts_or_op_error(new_source, "replace_function_body")
    if len(stmts) != 1 or not isinstance(stmts[0], cst.FunctionDef):
        raise OpError(
            "wrong_node_kind",
            "replace_function_body: new source must be exactly one function "
            f"definition (got {len(stmts)} statement(s), "
            f"first is {type(stmts[0]).__name__ if stmts else 'none'})",
        )
    new_func = stmts[0]

    # Guard: signature parity unless the def itself was the selected node.
    if not allow_signature_change:
        if _signature_repr(target, do_format) != _signature_repr(new_func, do_format):
            raise OpError(
                "wrong_node_kind",
                "replace_function_body: the function signature changed, but the "
                "edit was opened from inside the body. Open the function "
                "definition directly to change its signature.",
            )

    # Guard 2: import hoisting. Pull top-level imports out of the new body.
    func_body = list(new_func.body.body) if isinstance(new_func.body, cst.IndentedBlock) else []
    existing_keys = _collect_module_import_keys(wrapper.module)
    to_hoist: list[cst.BaseStatement] = []
    remaining: list[cst.BaseStatement] = []
    for stmt in func_body:
        if _is_import_stmt(stmt):
            keys = _import_dedupe_keys(stmt)
            if keys and keys <= existing_keys:
                # Duplicate of an existing module import → no-op hoist;
                # leave the user's line in the body (it's within span).
                remaining.append(stmt)
                continue
            to_hoist.append(stmt)
        else:
            remaining.append(stmt)

    if to_hoist:
        stripped = new_func.with_changes(
            body=new_func.body.with_changes(body=tuple(remaining))
        )
        referenced = _collect_names(stripped)
        for stmt in to_hoist:
            bound = _import_bound_names(stmt)
            # Star imports bind nothing trackable; we can't prove them
            # unused, so they're allowed through.
            if bound and not any(n in referenced for n in bound):
                raise OpError(
                    "unused_import",
                    "replace_function_body: hoisted import has no reference in "
                    f"the function body: {_render(stmt).strip()}",
                )

    new_func2 = new_func.with_changes(
        body=new_func.body.with_changes(body=tuple(remaining)),
        leading_lines=target.leading_lines,
    )

    transformer = _ReplaceTransformer(target, [new_func2])
    module2 = wrapper.module.visit(transformer)
    if not transformer.matched:
        raise OpError(
            "target_not_found",
            "replace_function_body: function resolved but was not reached by "
            "the rewriter (target is likely inside an unsupported context).",
        )

    hoist_clean = [s.with_changes(leading_lines=()) for s in to_hoist]
    module3 = module2.with_changes(
        body=tuple(_insert_imports_into_block(list(module2.body), hoist_clean))
    )
    out = module3.code

    # The confinement baseline (raw pre + hoist) is also what the M-DIRTY
    # black scoping measures against, so build it up front — the hoisted
    # imports sit above the function, so their line numbers are identical
    # in `baseline` and `out`, and only the function's own span shifts.
    base_module = wrapper.module.with_changes(
        body=tuple(_insert_imports_into_block(list(wrapper.module.body), hoist_clean))
    )
    baseline = base_module.code  # raw pre + hoist — NOT re-formatted

    # Guard 1: format-and-diff confinement. Faithful to the M2 invariant —
    # diff the black-formatted result against the PRE-edit source, rejecting
    # any change outside the function's span. The one allowed out-of-span
    # change (Guard 2's import hoist) is modelled by inserting those same
    # imports into the baseline first; everything else outside the span must
    # be byte-identical (so e.g. a non-black-clean line elsewhere that black
    # would reflow is still caught, exactly as for the position-targeted ops).
    #
    # M-DIRTY: black is offered the replaced function's span first, so a
    # non-black-clean line ELSEWHERE no longer manufactures a rejection,
    # with whole-file formatting kept as the fallback candidate. The check
    # itself is unchanged and every candidate must pass it. The hoisted
    # imports are deliberately NOT in the scoped range: a range ending at
    # the import block makes black rewrite the blank run after it (see
    # _format_candidates), and Guard 2 is about hoist *validity* —
    # used / not-duplicated / placed-in-block, all still enforced — not
    # about reformatting a statement libcst re-emits verbatim.
    bpos = None
    if do_diff_check:
        try:
            bw, btarget = _resolve(baseline, target_id)
        except KeyError as e:
            raise OpError(
                "diff_confinement_failed",
                f"replace_function_body: could not locate target in the "
                f"confinement baseline ({e}).",
                diff=_unified_diff(source, out),
            ) from e
        bpos = bw.resolve(meta.PositionProvider)[btarget]

    fn_span = (bpos.start.line, bpos.end.line) if bpos else None
    ranges = _edited_line_ranges(baseline, out, "replace_node", fn_span)

    last_error: Optional[Exception] = None
    out_rejected = out
    for candidate in _format_candidates(out, ranges, do_format):
        if not do_diff_check:
            return candidate
        try:
            _verify_diff_confined(
                baseline, candidate, fn_span, "replace_function_body"
            )
            if report is not None and do_format and candidate == out:
                report["formatted"] = False
            return candidate
        except RuntimeError as e:
            last_error = e
            out_rejected = candidate

    raise OpError(
        "diff_confinement_failed", str(last_error),
        diff=_unified_diff(source, out_rejected),
    ) from last_error


def op_replace_module_body(
    source: str,
    new_source: str,
    do_format: bool = True,
    do_diff_check: bool = True,
) -> str:
    """
    Replace the whole module with `new_source` (the module-level edit case;
    PLAN-v3-revised §A.4 / §C.4). The file *is* the unit, so there is no
    narrower span to confine to — the guard is parse + black + a structural
    CST round-trip (never a line splice). `do_diff_check` is intentionally a
    no-op here; the diff is still returned by the CLI for review.
    """
    src = new_source if new_source.endswith("\n") else new_source + "\n"
    try:
        new_module = cst.parse_module(src)
    except cst.ParserSyntaxError as e:
        raise OpError(
            "parse_error", f"replace_module_body: source is invalid Python: {e}"
        ) from e
    out = new_module.code
    if do_format:
        out = _run_black(out)
    return out


# ── orchestrator ─────────────────────────────────────────────

def apply(
    source: str,
    op: str,
    target_id: Optional[str],
    new_source: Optional[str],
    new_name: Optional[str],
    do_format: bool,
    do_diff_check: bool,
    default_value: Optional[str] = None,
    type_annotation: Optional[str] = None,
    position: Optional[str] = None,
    allow_signature_change: bool = False,
    report: Optional[dict] = None,
) -> str:
    """
    `report`, if given, is filled with diagnostics the caller may need to
    disclose. Currently: `report["formatted"] = False` when the edit only
    passed confinement with black skipped (see _format_candidates
    candidate 3) — the write is safe and verified, but THIS edit is not
    reformatted and the user should be told.
    """
    if report is not None:
        report["formatted"] = True
    # M18.2 — whole-scope ops run their own format-and-diff pipeline
    # (the import-hoist exception means the generic line-confinement can't
    # model their allowed out-of-span change). Early-return so the generic
    # steps 3 & 4 below don't double-process or reject the legal hoist.
    if op in _SELF_PIPELINE_OPS:
        if op == "replace_function_body":
            if target_id is None:
                raise ValueError("replace_function_body: expects <node_id>")
            return op_replace_function_body(
                source, target_id, new_source or "",
                allow_signature_change=allow_signature_change,
                do_format=do_format, do_diff_check=do_diff_check,
                report=report,
            )
        return op_replace_module_body(
            source, new_source or "",
            do_format=do_format, do_diff_check=do_diff_check,
        )

    # 1. Compute target's pre-edit span (skip for ops that don't have a single target)
    target_span: Optional[tuple[int, int]] = None
    if op != "append_end" and target_id is not None:
        try:
            wrapper, target = _resolve(source, target_id)
        except KeyError as e:
            # For M12.1 ops (and capture_probe — M-RUN3), the per-op wrapper
            # translates this to OpError(target_not_found). Mirror that here so
            # the orchestrator-level resolve also surfaces the structured kind.
            if op in _M12_OPS or op == "capture_probe":
                raise OpError("target_not_found", str(e)) from e
            raise
        pos = wrapper.resolve(meta.PositionProvider)
        p = pos[target]
        target_span = (p.start.line, p.end.line)

    # 2. Apply op
    if op == "replace_node":
        out = op_replace_node(source, target_id, new_source)
    elif op == "insert_before":
        out = op_insert_before(source, target_id, new_source)
    elif op == "insert_after":
        out = op_insert_after(source, target_id, new_source)
    elif op == "delete_node":
        out = op_delete_node(source, target_id)
    elif op == "capture_probe":
        # `new_name` carries the capture variable (no stdin — the probe text
        # is fixed inside the op so callers can never vary the injected code).
        if new_name is None:
            raise ValueError("capture_probe: missing capture variable (passed via new_name)")
        out = op_capture_probe(source, target_id, new_name)
    elif op == "append_end":
        out = op_append_end(source, new_source)
    elif op == "rename_in_scope":
        out = op_rename_in_scope(source, target_id, new_name)
    elif op == "insert_as_first_child":
        out = op_insert_as_first_child(source, target_id, new_source)
    elif op == "insert_as_last_child":
        out = op_insert_as_last_child(source, target_id, new_source)
    elif op == "append_positional_arg":
        out = op_append_positional_arg(source, target_id, new_source)
    elif op == "append_keyword_arg":
        # main() passes `new_name` as the keyword key for this op (single
        # extra positional arg slot; the value comes from stdin like other
        # ops). Programmatic apply() callers do the same.
        if new_name is None:
            raise ValueError("append_keyword_arg: missing keyword key (passed via new_name)")
        out = op_append_keyword_arg(source, target_id, new_name, new_source)
    elif op == "add_function_parameter":
        # `new_name` carries param_name; `default_value` / `type_annotation` /
        # `position` are M16.1-specific. CLI passes them via flags.
        if new_name is None:
            raise ValueError("add_function_parameter: missing param_name (passed via new_name)")
        out = op_add_function_parameter(
            source, target_id, new_name,
            default_value=default_value,
            type_annotation=type_annotation,
            position=position if position is not None else "end",
        )
    else:
        raise ValueError(f"unknown op: {op}")

    # 3 + 4. Format with black, then verify the diff is confined.
    #
    # M-DIRTY couples these steps: black is offered the edited span first
    # (so a file that was never black-clean keeps its formatting outside
    # the target instead of being normalised into a rejection), and falls
    # back to whole-file formatting — today's behaviour — if that
    # candidate fails. The confinement check below is UNCHANGED and every
    # candidate must pass it, so nothing is written that would not have
    # been written before; the change only adds an option that lets
    # legitimate edits to real-world code through.
    #
    # rename_in_scope is exempt from formatting entirely: identifier
    # substitution never needs a reformat, and it is the one op with no
    # confinement check (a rename legitimately touches every reference
    # site), so whole-file black there is unguarded churn on a dirty file.
    if op == "rename_in_scope":
        return out

    ranges = _edited_line_ranges(source, out, op, target_span)
    last_error: Optional[Exception] = None
    for candidate in _format_candidates(out, ranges, do_format):
        if not do_diff_check:
            return candidate
        try:
            _verify_diff_confined(source, candidate, target_span or (1, 1), op)
            if report is not None and do_format and candidate == out:
                report["formatted"] = False
            return candidate
        except RuntimeError as e:
            last_error = e

    # Every candidate escaped the target span — a genuine rejection.
    # New ops report diff-confinement failures with errorKind. Pre-M12.1
    # ops keep their existing RuntimeError contract.
    assert last_error is not None
    if op in _M12_OPS and not isinstance(last_error, OpError):
        raise OpError("diff_confinement_failed", str(last_error)) from last_error
    raise last_error


# ── CLI ──────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="CST-backed rewriter for VibeGraph.")
    ap.add_argument("file", help="Path to the Python source file to edit.")
    ap.add_argument(
        "op",
        choices=[
            "replace_node",
            "insert_before",
            "insert_after",
            "delete_node",
            "append_end",
            "rename_in_scope",
            # M-RUN3 run-probe op
            "capture_probe",
            # M12.1 add-component ops
            "insert_as_first_child",
            "insert_as_last_child",
            "append_positional_arg",
            "append_keyword_arg",
            # M16.1 signature-edit op
            "add_function_parameter",
            # M18.2 whole-scope ops
            "replace_function_body",
            "replace_module_body",
            # PLAN-v7 4a greenfield op
            "create_file",
        ],
    )
    ap.add_argument("rest", nargs="*", help="Op-specific args (node_id, new_name).")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-format", action="store_true")
    ap.add_argument("--no-diff", action="store_true")
    # M18.2 — replace_function_body: permit signature edits (set by the panel
    # only when the selected node IS the function_def, not when editing from
    # inside its body). Without it, signature parity is enforced.
    ap.add_argument("--allow-signature-change", action="store_true")
    # M16.1 flags — only meaningful for add_function_parameter.
    ap.add_argument("--default", default=None, help="Default-value expression for add_function_parameter.")
    ap.add_argument("--annotation", default=None, help="Type-annotation expression for add_function_parameter.")
    ap.add_argument("--position", default="end", help="'end' or 'before:<existing_param_name>'.")
    args = ap.parse_args()

    try:
        path = args.file

        # PLAN-v7 4a — create_file is the one op whose target must NOT
        # exist, so it branches BEFORE the isfile check and skips the
        # source-read → node-map pipeline entirely (there is no pre-edit
        # source). Its confinement analogue is the guard set below; the
        # whole file is the surfaced diff (dry-run prints it; wet success
        # carries it as newSource for the human gate).
        if args.op == "create_file":
            if args.rest:
                raise ValueError("create_file: expects no positional args")
            create_source = sys.stdin.read()
            if not create_source.strip():
                raise OpError(
                    "empty_source",
                    "create_file: empty source — refusing to create an empty module",
                )
            if not path.endswith(".py"):
                raise OpError(
                    "invalid_path",
                    f"create_file: only .py files can be created (got: {path})",
                )
            if os.path.exists(path):
                raise OpError(
                    "file_exists",
                    f"create_file: refusing to overwrite existing path: {path} "
                    "(creation only — edit existing files through the targeted ops)",
                )
            # OPUS-SHOWDOWN finding (2026-08-02): a builder proposing a
            # PACKAGE layout (habitkit/streaks.py) failed its floor because
            # this op refused a missing parent dir — an artificial ceiling on
            # module structure. Widening + its guards: missing parents are
            # created, but ONLY for a traversal-free path (no ".." segments —
            # project-root containment stays the caller's guard, and a
            # dot-free path cannot escape it), and never through an existing
            # non-directory (makedirs raises → invalid_path). Directory
            # creation writes no file content, so the surfaced diff is
            # unchanged: the whole new file, exactly as before.
            if ".." in Path(path).parts:
                raise OpError(
                    "invalid_path",
                    f"create_file: path may not contain '..' segments: {path}",
                )
            # Probe an existing-but-blocked parent eagerly so dry and wet
            # runs refuse identically; actual creation waits for the wet
            # path (a dry run must leave NO trace, directories included).
            parent = os.path.dirname(os.path.abspath(path))
            blocked = next(
                (p for p in [Path(parent), *Path(parent).parents] if p.exists()),
                None,
            )
            if blocked is not None and not blocked.is_dir():
                raise OpError(
                    "invalid_path",
                    f"create_file: parent path is blocked by a non-directory: {blocked}",
                )
            out = op_create_file(create_source, do_format=not args.no_format)
            if args.dry_run:
                sys.stdout.write(out)
                return
            try:
                os.makedirs(parent, exist_ok=True)
            except (OSError, FileExistsError) as e:
                raise OpError(
                    "invalid_path",
                    f"create_file: cannot create parent directory {parent}: {e}",
                ) from e
            with open(path, "w", encoding="utf-8") as f:
                f.write(out)
            print(json.dumps({"success": True, "newSource": out}))
            return

        if not os.path.isfile(path):
            raise FileNotFoundError(f"file not found: {path}")
        with open(path, "r", encoding="utf-8") as f:
            source = f.read()

        target_id: Optional[str] = None
        new_name: Optional[str] = None
        new_source: Optional[str] = None

        op = args.op
        rest = args.rest

        if op in ("replace_node", "insert_before", "insert_after"):
            if len(rest) != 1:
                raise ValueError(f"{op}: expects <node_id> arg")
            target_id = rest[0]
            new_source = sys.stdin.read()
        elif op == "delete_node":
            if len(rest) != 1:
                raise ValueError("delete_node: expects <node_id> arg")
            target_id = rest[0]
        elif op == "append_end":
            if len(rest) != 0:
                raise ValueError("append_end: expects no positional args")
            new_source = sys.stdin.read()
        elif op == "rename_in_scope":
            if len(rest) != 2:
                raise ValueError("rename_in_scope: expects <node_id> <new_name>")
            target_id = rest[0]
            new_name = rest[1]
        elif op == "capture_probe":
            # M-RUN3 — no stdin: the probe text is fixed inside the op.
            if len(rest) != 2:
                raise ValueError("capture_probe: expects <node_id> <var_name>")
            target_id = rest[0]
            new_name = rest[1]  # `new_name` slot carries the capture variable
        elif op in ("insert_as_first_child", "insert_as_last_child", "append_positional_arg"):
            if len(rest) != 1:
                raise ValueError(f"{op}: expects <node_id> arg")
            target_id = rest[0]
            new_source = sys.stdin.read()
        elif op == "append_keyword_arg":
            if len(rest) != 2:
                raise ValueError("append_keyword_arg: expects <node_id> <key> args")
            target_id = rest[0]
            new_name = rest[1]  # `new_name` slot carries the keyword key
            new_source = sys.stdin.read()
        elif op == "add_function_parameter":
            if len(rest) != 2:
                raise ValueError("add_function_parameter: expects <node_id> <param_name> args")
            target_id = rest[0]
            new_name = rest[1]  # `new_name` slot carries param_name
        elif op == "replace_function_body":
            if len(rest) != 1:
                raise ValueError("replace_function_body: expects <node_id> arg")
            target_id = rest[0]
            new_source = sys.stdin.read()
        elif op == "replace_module_body":
            # The whole module is the unit; a node_id may be passed for
            # context but is not required (and is ignored).
            if len(rest) > 1:
                raise ValueError("replace_module_body: expects at most <node_id>")
            target_id = rest[0] if rest else None
            new_source = sys.stdin.read()

        # M10R guard — every source-consuming op (new_source was read above)
        # must receive a non-empty payload. An empty payload parses to zero
        # statements: replace_node would apply it as a silent delete that
        # passes diff confinement and reports success; inserts would no-op.
        # Deletion must be explicit (delete_node).
        if new_source is not None and not new_source.strip():
            raise OpError(
                "empty_source",
                f"{op}: empty source — refusing implicit delete/no-op; "
                "use delete_node to remove a node",
            )

        report: dict = {}
        out = apply(
            source=source,
            op=op,
            target_id=target_id,
            new_source=new_source,
            new_name=new_name,
            do_format=not args.no_format,
            do_diff_check=not args.no_diff,
            default_value=args.default,
            type_annotation=args.annotation,
            position=args.position,
            allow_signature_change=args.allow_signature_change,
            report=report,
        )

        # M18.2 — whole-scope ops surface the unified diff + new source so
        # the panel can render a pre-commit confirmation (Guard 3).
        extra = {}
        if op in _SELF_PIPELINE_OPS:
            extra = {"diff": _unified_diff(source, out), "newSource": out}
        # Only passed confinement with black skipped: the write is verified,
        # but THIS edit is unformatted and the caller must say so.
        if report.get("formatted") is False:
            extra["formatted"] = False

        if args.dry_run:
            sys.stdout.write(out)
            return
        with open(path, "w", encoding="utf-8") as f:
            f.write(out)
        print(json.dumps({"success": True, **extra}))
    except OpError as e:
        # M12.1: structured error path. Webview branches on errorKind.
        # M18.2: diff-related rejections carry the offending diff.
        payload = {
            "success": False,
            "error": f"{type(e).__name__}: {e.msg}",
            "errorKind": e.kind,
        }
        if getattr(e, "diff", None):
            payload["diff"] = e.diff
        print(json.dumps(payload))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"{type(e).__name__}: {e}"}))


if __name__ == "__main__":
    main()
