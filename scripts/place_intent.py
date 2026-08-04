#!/usr/bin/env python3
"""
Heuristic intent placer — Tier 1 of Mode B (PLAN-v3-revised §A.3 / §B.1).

Given a plain-language description, the *selected* IR node, and the
enclosing function's IR neighbourhood, decide **which CST op runs and
where** — without an LLM. Deterministic regex / keyword rules cover the
common ~70 % of intents; anything that doesn't clear the confidence
threshold returns no proposal so the caller falls through to the Tier 2
scoped LLM call (M18.5).

This is *statement-level* placement (where in the current function does
the new code go), distinct from M15's *file-level* placement
(`place_new_code.py`, which only runs when a brand-new function/class is
created). Both ultimately converge on the CST-rewriter chokepoint.

Output tuple
------------
Every rule emits a `Proposal(op, target_id, source, confidence, reason)`.
`op` is a `scripts/cst_rewrite.py` op name (or "rejected" for an
intentionally-unsupported intent like rename). The proposal is rendered
in the panel's Monaco for the human-approval gate; Save commits it
through the standard op dispatcher (M18.5).

Usage (CLI)
-----------
    python3 place_intent.py < payload.json

stdin payload (JSON):
    {
      "intent": "add a verbose argument to the create subparser",
      "target": { "id": str, "type": str, "name"?: str, "parentId"?: str },
      "ctx": {
        "nodes": [ <file IR nodes> ],
        "filePath": str,
        "enclosingFunctionSource"?: str   // def→end text, for wrap/codegen rules
      }
    }

stdout (JSON):
    {
      "proposal":   { op, target_id, source, confidence, reason } | null,
      "matched":    bool,          // a rule fired at/above threshold
      "candidates": [ <proposal>, ... ]   // every rule that returned, ranked
    }

Pluggability
------------
A rule is one decorated function:

    @rule(priority=0.80)
    def add_raise_rule(intent, target, ctx):
        if not re.search(r"\\b(raise|throw)\\b", intent, re.I): return None
        return Proposal("insert_after", target["id"], "raise Exception(...)",
                        confidence=0.8, reason="matched 'raise'")

Higher `priority` rules are evaluated first; the first match clearing
`MIN_CONFIDENCE` wins. Adding a rule = define + decorate; no registry
edit. Mirrors `place_new_code.py` §3.4 pluggability.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Optional

import libcst as cst

MIN_CONFIDENCE = 0.7


# ── proposal + rule registry ──────────────────────────────────────────

@dataclass
class Proposal:
    op: str                       # cst_rewrite op name, or "rejected"
    target_id: Optional[str]
    source: str
    confidence: float
    reason: str
    rejected: bool = False        # true for intentionally-unsupported intents


# (priority, name, fn) — fn(intent: str, target: dict, ctx: dict) -> Proposal|None
_RULES: list[tuple[float, str, Callable[[str, dict, dict], Optional[Proposal]]]] = []


def rule(priority: float):
    def deco(fn):
        _RULES.append((priority, fn.__name__, fn))
        return fn
    return deco


# ── IR neighbourhood helpers ──────────────────────────────────────────

def _nodes(ctx: dict) -> list[dict]:
    return ctx.get("nodes") or []


def _by_id(ctx: dict) -> dict:
    return {n["id"]: n for n in _nodes(ctx)}


def _enclosing_function(target: dict, ctx: dict) -> Optional[dict]:
    """Walk parentId from `target` to the nearest function_def (self counts)."""
    byid = _by_id(ctx)
    cur: Optional[dict] = byid.get(target.get("id")) or target
    seen = 0
    while cur and seen < 10_000:
        seen += 1
        if cur.get("type") == "function_def":
            return cur
        pid = cur.get("parentId")
        cur = byid.get(pid) if pid else None
    return None


def _name_of(node: dict) -> Optional[str]:
    return node.get("name") or node.get("funcName") or node.get("target")


def _find_named_call(name: str, ctx: dict) -> Optional[dict]:
    """
    Find a call-ish node bound to / referencing `name` — e.g. the
    `create = sub.add_parser("create")` assignment, so "add an argument to
    the create subparser" resolves to that receiver.
    """
    for n in _nodes(ctx):
        if n.get("type") in ("call", "assignment") and _name_of(n) == name:
            return n
    # Fall back: any node whose id segment ends with the name.
    for n in _nodes(ctx):
        if n["id"].split("/")[-1].split(".")[0] == name:
            return n
    return None


def _enclosing_call(target: dict, ctx: dict) -> Optional[dict]:
    """The target itself if it's a call, else the nearest call ancestor."""
    byid = _by_id(ctx)
    cur: Optional[dict] = byid.get(target.get("id")) or target
    seen = 0
    while cur and seen < 10_000:
        seen += 1
        if cur.get("type") == "call":
            return cur
        pid = cur.get("parentId")
        cur = byid.get(pid) if pid else None
    return None


_PY_NAME = r"[A-Za-z_][A-Za-z0-9_]*"


# ── rules (priority order) ────────────────────────────────────────────

@rule(priority=0.95)
def add_argument_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    m = re.search(rf"add (?:a |an )?(?P<name>{_PY_NAME})(?: keyword)? (?:arg|argument)", intent, re.I)
    if not m:
        return None
    arg = m.group("name")
    # "to the X (sub)parser/function/call" → resolve that receiver.
    recv = re.search(rf"to (?:the )?(?P<recv>{_PY_NAME})\b", intent, re.I)
    call = _find_named_call(recv.group("recv"), ctx) if recv else None
    call = call or _enclosing_call(target, ctx)
    if not call:
        return None
    return Proposal(
        op="append_keyword_arg",
        target_id=call["id"],
        source=f"{arg}=None",
        confidence=0.9,
        reason=f"'add {arg} argument' → append_keyword_arg on {_name_of(call) or call['id'].split('/')[-1]}",
    )


@rule(priority=0.93)
def add_parameter_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    m = re.search(rf"add (?:a |an )?(?P<name>{_PY_NAME}) param(?:eter)?", intent, re.I)
    if not m:
        return None
    fn = _enclosing_function(target, ctx)
    if not fn:
        return None
    return Proposal(
        op="add_function_parameter",
        target_id=fn["id"],
        source=f"{m.group('name')}",
        confidence=0.88,
        reason=f"'add {m.group('name')} parameter' → add_function_parameter on {_name_of(fn)}",
    )


@rule(priority=0.9)
def add_import_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    # "add an import for os" / "import os" / "add a json import"
    m = re.search(rf"import (?:for )?(?P<mod>{_PY_NAME}(?:\.{_PY_NAME})*)", intent, re.I)
    if not m:
        m = re.search(rf"add (?:a |an )?(?P<mod>{_PY_NAME}) import", intent, re.I)
        if not m:
            return None
    mod = m.group("mod")
    # Anchor: insert before the first top-level statement of the file
    # (module-scope nodes have no parentId). Imports land in the block.
    top = [n for n in _nodes(ctx) if not n.get("parentId")]
    anchor = top[0]["id"] if top else target["id"]
    return Proposal(
        op="insert_before",
        target_id=anchor,
        source=f"import {mod}",
        confidence=0.85,
        reason=f"'import {mod}' → insert_before first top-level statement",
    )


@rule(priority=0.85)
def add_return_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    if not re.search(r"\badd (?:a )?return\b", intent, re.I):
        return None
    fn = _enclosing_function(target, ctx)
    if not fn:
        return None
    m = re.search(r"return (?P<expr>.+)$", intent, re.I)
    expr = m.group("expr").strip() if m else "None"
    # End of the *function* body — insert_as_last_child, not append_end
    # (which is module-scope; §A.3's "append_end" is loose wording).
    return Proposal(
        op="insert_as_last_child",
        target_id=fn["id"],
        source=f"return {expr}",
        confidence=0.82,
        reason=f"'add return' → insert_as_last_child of {_name_of(fn)}",
    )


@rule(priority=0.82)
def add_docstring_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    if not re.search(r"\b(docstring|doc string)\b", intent, re.I):
        return None
    fn = _enclosing_function(target, ctx)
    if not fn:
        return None
    return Proposal(
        op="insert_as_first_child",
        target_id=fn["id"],
        source='"""TODO: describe."""',
        confidence=0.8,
        reason=f"'add docstring' → insert_as_first_child of {_name_of(fn)}",
    )


@rule(priority=0.8)
def add_print_or_log_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    is_log = bool(re.search(r"\blog(?:ging)?\b", intent, re.I))
    is_print = bool(re.search(r"\bprint\b", intent, re.I))
    if not (is_log or is_print):
        return None
    if is_log:
        src, why = 'logging.info("TODO")', "log"
    else:
        src, why = 'print("TODO")', "print"
    return Proposal(
        op="insert_after",
        target_id=target["id"],
        source=src,
        confidence=0.78,
        reason=f"'add {why}' → insert_after the selected node",
    )


@rule(priority=0.78)
def add_raise_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    if not re.search(r"\b(raise|throw)\b", intent, re.I):
        return None
    m = re.search(rf"(?:raise|throw) (?:a |an )?(?P<exc>{_PY_NAME})", intent, re.I)
    exc = m.group("exc") if m else "Exception"
    return Proposal(
        op="insert_after",
        target_id=target["id"],
        source=f'raise {exc}("TODO")',
        confidence=0.76,
        reason=f"'raise' → insert_after with {exc}",
    )


@rule(priority=0.75)
def add_if_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    if not re.search(r"\badd (?:a |an )?if\b", intent, re.I):
        return None
    return Proposal(
        op="insert_after",
        target_id=target["id"],
        source="if True:\n    pass",
        confidence=0.74,
        reason="'add if' → insert_after with a pass body",
    )


@rule(priority=0.7)
def wrap_try_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    if not re.search(r"\bwrap\b.*\btry\b|\btry\b.*\bwrap\b|wrap .*except", intent, re.I):
        return None
    fn = _enclosing_function(target, ctx)
    src = ctx.get("enclosingFunctionSource")
    if not fn or not src:
        return None
    wrapped = _wrap_function_body_in_try(src)
    if wrapped is None:
        return None
    return Proposal(
        op="replace_function_body",
        target_id=fn["id"],
        source=wrapped,
        confidence=0.72,
        reason=f"'wrap in try' → replace_function_body of {_name_of(fn)} with a try/except",
    )


@rule(priority=0.99)
def rename_rejected_rule(intent: str, target: dict, ctx: dict) -> Optional[Proposal]:
    # Rename is a cross-scope refactor — out of scope for statement-level
    # placement. Match it explicitly so the UI says so rather than burning
    # a Tier-2 LLM call on something we won't commit.
    if not re.search(rf"\brename\b .*\bto\b", intent, re.I):
        return None
    return Proposal(
        op="rejected",
        target_id=target.get("id"),
        source="",
        confidence=1.0,
        reason="rename is a refactor, out of scope for intent placement",
        rejected=True,
    )


# ── try/except codegen (libcst, for wrap_try) ─────────────────────────

def _wrap_function_body_in_try(func_source: str) -> Optional[str]:
    """
    Parse a single function definition and wrap its body statements in a
    `try: ... except Exception: raise` block. Returns the new function
    source, or None if `func_source` isn't a single function.
    """
    src = func_source if func_source.endswith("\n") else func_source + "\n"
    try:
        module = cst.parse_module(src)
    except cst.ParserSyntaxError:
        return None
    body = list(module.body)
    if len(body) != 1 or not isinstance(body[0], cst.FunctionDef):
        return None
    fn = body[0]
    if not isinstance(fn.body, cst.IndentedBlock):
        return None
    try_node = cst.Try(
        body=cst.IndentedBlock(body=tuple(fn.body.body)),
        handlers=[
            cst.ExceptHandler(
                type=cst.Name("Exception"),
                body=cst.IndentedBlock(body=[cst.SimpleStatementLine([cst.Raise()])]),
            )
        ],
    )
    new_fn = fn.with_changes(body=fn.body.with_changes(body=[try_node]))
    return cst.Module(body=[new_fn]).code


# ── dispatch ──────────────────────────────────────────────────────────

def place(intent: str, target: dict, ctx: dict) -> dict:
    """Run all rules in priority order; the first match clearing
    MIN_CONFIDENCE wins. Returns {proposal, matched, candidates}."""
    # Pass the original (stripped) text — rules match case-INSENSITIVELY
    # via re.I but must preserve the case of captured identifiers
    # (e.g. ValueError, a parameter named Timeout).
    text = (intent or "").strip()
    candidates: list[Proposal] = []
    best: Optional[Proposal] = None
    for _priority, _name, fn in sorted(_RULES, key=lambda r: r[0], reverse=True):
        try:
            prop = fn(text, target, ctx)
        except Exception:
            prop = None
        if prop is None:
            continue
        candidates.append(prop)
        if best is None and prop.confidence >= MIN_CONFIDENCE:
            best = prop
    return {
        "proposal": asdict(best) if best else None,
        "matched": best is not None,
        "candidates": [asdict(c) for c in candidates],
    }


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"proposal": None, "matched": False, "candidates": [],
                          "error": f"bad payload: {e}"}))
        return
    result = place(
        payload.get("intent", ""),
        payload.get("target") or {},
        payload.get("ctx") or {},
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
