#!/usr/bin/env python3
"""
File-placement heuristics for newly-created code.

NOTE: the place-new-code WS runtime path was removed (it was only driven by
the now-parked Add-component modal). This script + its test:placement suite
are retained as reference for M18.4's heuristic intent placer
(place_intent.py) — same "given new code, where does it go?" problem; the
rules here are reusable logic for that milestone.

M15.1 — PLAN-v4 §3 / M15. Five deterministic rules applied in priority
order; first match with confidence ≥ 0.7 wins. If nothing clears 0.7,
return top-3 candidates ranked + the default (the caller's active
file) so the UI can prompt.

Usage (CLI)
-----------
    python3 place_new_code.py < payload.json

stdin payload (JSON):
    {
      "source":      "def list_users(): ...",
      "context":     { "newName"?: str,
                       "calls"?: [str],
                       "decorators"?: [str],
                       "baseClass"?: str },
      "projectIR":   <project_ir envelope, PLAN-v2 §1.1>,
      "dropTargetFile": "cli.py"   // active file — the rule-5 default
    }

stdout (JSON):
    {
      "rules":   [{ "rule": str, "file": str|None, "confidence": float, "reason": str }, ...],
      "best":    { "rule": str, "file": str } | null,
      "ambiguous": bool,
      "candidates": [str, ...]
    }

Rules
-----
1. route_handler  — @app.route / @bp.route / @app.<verb> in source
                    OR context.decorators. Confidence 0.95 when source
                    matches AND project has ≥1 existing route handler.
2. test_fixture   — context.newName starts with "test_" AND project
                    has a matching test_<sibling>.py file. Confidence
                    0.9.
3. db_helper      — ≥50 % of context.calls match the M9.1
                    effectKind=="db" patterns (cursor.execute,
                    session.*, etc.). Confidence 0.85 when matched
                    AND project has a db-helper file.
4. data_class     — source is a class_def with @dataclass / Pydantic
                    BaseModel base / dataclasses-style attributes
                    only. Confidence 0.80 when matched.
5. default        — always returns dropTargetFile with confidence 0.5
                    (below 0.7 threshold). Acts as the fallback when
                    nothing else clears.

Pluggability
------------
Rules live in _PLACEMENT_RULES (module-level list). Each rule is:
    (source: str, context: dict, project_ir: dict, drop_target: str|None)
     -> { file: str|None, confidence: float, reason: str }

Adding a new rule is one function + one list-append. See the example
comment block below for a template.
"""

from __future__ import annotations

import json
import re
import sys
import traceback
from typing import Any, Optional


# ── Confidence threshold ─────────────────────────────────────────────

# Below this confidence, the rule is recorded but doesn't win outright;
# the resolver may prompt the user with top-3 candidates.
HIGH_CONFIDENCE = 0.7


# ── Rule implementations ─────────────────────────────────────────────

# Matches both source-form ("@app.route(...)") and the IR's stored
# form (no leading "@" — parse_cst.py strips it when capturing the
# decorator's source text).
_ROUTE_DECORATOR_RE = re.compile(
    r"@?\w+\.(?:route|get|post|put|patch|delete|head|options)\s*\(",
)


def _file_has_routes(file_ir: dict) -> int:
    """Count route-decorated function_defs in a per-file IR."""
    n = 0
    for node in file_ir.get("nodes", []):
        if node.get("type") != "function_def":
            continue
        for d in node.get("decorators", []) or []:
            if _ROUTE_DECORATOR_RE.search(d or ""):
                n += 1
                break
    return n


def _rule_route_handler(source, context, project_ir, drop_target):
    src_has = bool(_ROUTE_DECORATOR_RE.search(source))
    ctx_decs = context.get("decorators") or []
    ctx_has = any(_ROUTE_DECORATOR_RE.search(d or "") for d in ctx_decs)
    if not (src_has or ctx_has):
        return {
            "file": None, "confidence": 0.0,
            "reason": "no route decorator in source or context.decorators",
        }
    # Rank files by existing route count.
    files = project_ir.get("files", {}) or {}
    ranked = sorted(
        ((path, _file_has_routes(fir)) for path, fir in files.items()),
        key=lambda p: (-p[1], p[0]),
    )
    best = next((path for path, count in ranked if count > 0), None)
    if best is None:
        # New project with no existing routes — confidence drops; we
        # still propose the drop_target so the user gets a sensible
        # default.
        return {
            "file": drop_target, "confidence": 0.55,
            "reason": "matched route decorator but no existing route handlers in project",
        }
    return {
        "file": best, "confidence": 0.95,
        "reason": f"matched route decorator; {best} has {dict(ranked)[best]} existing route handlers",
    }


def _rule_test_fixture(source, context, project_ir, drop_target):
    name = context.get("newName") or ""
    if not name.startswith("test_"):
        return {
            "file": None, "confidence": 0.0,
            "reason": "newName does not start with test_",
        }
    files = project_ir.get("files", {}) or {}
    # Look for existing test_*.py files, preferring tests/ subdir.
    test_files = [p for p in files if "test_" in p or "/tests/" in p]
    if not test_files:
        return {
            "file": None, "confidence": 0.4,
            "reason": "test_ name but no existing test_*.py files in project",
        }
    # Prefer the test file matching the drop target's base name, then
    # any tests/test_<*>.py, then lex order.
    drop_base = (drop_target or "").rsplit("/", 1)[-1].replace(".py", "")
    expected = f"test_{drop_base}.py"
    sibling = next((p for p in test_files if p.endswith(expected)), None)
    if sibling:
        return {
            "file": sibling, "confidence": 0.9,
            "reason": f"test_ name pairs with sibling test file {sibling}",
        }
    return {
        "file": sorted(test_files)[0], "confidence": 0.75,
        "reason": "test_ name; picked the first test_*.py in the project",
    }


_DB_PATTERN_RE = re.compile(
    r"\b(?:cursor|conn|db|session|engine)\."
    r"(?:execute|fetchone|fetchall|fetchmany|commit|rollback|close)",
)


def _rule_db_helper(source, context, project_ir, drop_target):
    calls = context.get("calls") or []
    if not calls:
        # Fall back to source-pattern matching if calls weren't pre-extracted.
        db_count = len(_DB_PATTERN_RE.findall(source))
        if db_count == 0:
            return {
                "file": None, "confidence": 0.0,
                "reason": "no DB-pattern calls in source or context.calls",
            }
        total = max(1, source.count("("))
        ratio = db_count / total
    else:
        db_count = sum(1 for c in calls if _DB_PATTERN_RE.search(c or ""))
        total = len(calls)
        ratio = db_count / total if total else 0
    if ratio < 0.5:
        return {
            "file": None, "confidence": 0.0,
            "reason": f"only {db_count}/{total} calls match DB patterns (below 50%)",
        }
    # Find existing files with DB helpers. Use the same M9.1
    # effectKind="db" signal — count nodes per file.
    files = project_ir.get("files", {}) or {}
    ranked = []
    for path, fir in files.items():
        n = sum(1 for node in fir.get("nodes", [])
                if node.get("effectKind") == "db")
        if n > 0:
            ranked.append((path, n))
    ranked.sort(key=lambda p: (-p[1], p[0]))
    if not ranked:
        return {
            "file": None, "confidence": 0.4,
            "reason": f"DB-pattern source ({db_count}/{total}) but no existing db-helper file",
        }
    return {
        "file": ranked[0][0], "confidence": 0.85,
        "reason": f"{db_count}/{total} calls are DB; {ranked[0][0]} has {ranked[0][1]} existing db nodes",
    }


_DATACLASS_DECO_RE = re.compile(r"@(?:dataclass|dataclasses\.dataclass)\b")
_PYDANTIC_BASE_RE = re.compile(r"class\s+\w+\s*\(\s*(?:BaseModel|pydantic\.BaseModel)\s*\)")


def _rule_data_class(source, context, project_ir, drop_target):
    is_dc = bool(_DATACLASS_DECO_RE.search(source))
    is_pyd = bool(_PYDANTIC_BASE_RE.search(source))
    base = context.get("baseClass") or ""
    ctx_pyd = base in ("BaseModel", "pydantic.BaseModel")
    if not (is_dc or is_pyd or ctx_pyd):
        return {
            "file": None, "confidence": 0.0,
            "reason": "no @dataclass decorator or BaseModel base",
        }
    # Find files with existing dataclass / Pydantic-style class_defs.
    files = project_ir.get("files", {}) or {}
    ranked = []
    for path, fir in files.items():
        n = 0
        for node in fir.get("nodes", []):
            if node.get("type") != "class_def":
                continue
            decs = node.get("decorators") or []
            bases = node.get("bases") or []
            if any(_DATACLASS_DECO_RE.search(d or "") for d in decs):
                n += 1
                continue
            if any(b in ("BaseModel", "pydantic.BaseModel") for b in bases):
                n += 1
        if n > 0:
            ranked.append((path, n))
    ranked.sort(key=lambda p: (-p[1], p[0]))
    if not ranked:
        return {
            "file": drop_target, "confidence": 0.55,
            "reason": "matched data-class shape but no existing model file",
        }
    return {
        "file": ranked[0][0], "confidence": 0.80,
        "reason": f"matched data-class; {ranked[0][0]} has {ranked[0][1]} other model classes",
    }


def _rule_default(source, context, project_ir, drop_target):
    return {
        "file": drop_target, "confidence": 0.5,
        "reason": "default — the active file the user dropped on",
    }


_PLACEMENT_RULES = [
    ("route_handler", _rule_route_handler),
    ("test_fixture", _rule_test_fixture),
    ("db_helper", _rule_db_helper),
    ("data_class", _rule_data_class),
    ("default", _rule_default),
]


# ── To add a new rule ─────────────────────────────────────────────────
#
#     def _rule_my_thing(source, context, project_ir, drop_target):
#         if not matches_my_thing(...):
#             return {"file": None, "confidence": 0.0, "reason": "..."}
#         return {"file": "...", "confidence": 0.9, "reason": "..."}
#
#     _PLACEMENT_RULES.insert(
#         <index>, ("my_thing", _rule_my_thing),
#     )
#
# Rules are tried in order; first to clear HIGH_CONFIDENCE wins. Put
# higher-confidence / more-specific rules earlier in the list.


# ── Resolver ─────────────────────────────────────────────────────────

def place(source: str, context: dict, project_ir: dict,
          drop_target: Optional[str]) -> dict:
    rule_results: list[dict] = []
    for name, fn in _PLACEMENT_RULES:
        try:
            r = fn(source, context or {}, project_ir or {}, drop_target)
        except Exception as e:
            r = {
                "file": None, "confidence": 0.0,
                "reason": f"rule {name} raised: {type(e).__name__}: {e}",
            }
        rule_results.append({
            "rule": name,
            "file": r.get("file"),
            "confidence": float(r.get("confidence") or 0.0),
            "reason": r.get("reason") or "",
        })

    # Pick best: highest-confidence rule whose confidence ≥ threshold.
    qualifying = [r for r in rule_results if r["file"] and r["confidence"] >= HIGH_CONFIDENCE]
    qualifying.sort(key=lambda r: -r["confidence"])
    best = None
    ambiguous = False
    if qualifying:
        best = {"rule": qualifying[0]["rule"], "file": qualifying[0]["file"]}
    else:
        # Nothing cleared the bar. Show top-3 sub-threshold candidates
        # so the UI can prompt.
        ranked = sorted(
            (r for r in rule_results if r["file"]),
            key=lambda r: -r["confidence"],
        )[:3]
        ambiguous = True
        candidates = [r["file"] for r in ranked]
        # De-dupe while preserving order.
        seen: set[str] = set()
        unique: list[str] = []
        for c in candidates:
            if c and c not in seen:
                seen.add(c)
                unique.append(c)
        # Ensure the default (drop_target) is in the candidate list.
        if drop_target and drop_target not in seen:
            unique.append(drop_target)
        return {
            "rules": rule_results,
            "best": None,
            "ambiguous": True,
            "candidates": unique,
        }

    return {
        "rules": rule_results,
        "best": best,
        "ambiguous": False,
        "candidates": [best["file"]],
    }


# ── CLI ──────────────────────────────────────────────────────────────

def _cli() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({
            "error": f"invalid JSON payload on stdin: {e}",
            "rules": [], "best": None, "ambiguous": True, "candidates": [],
        }))
        return 2
    try:
        result = place(
            source=payload.get("source", ""),
            context=payload.get("context", {}) or {},
            project_ir=payload.get("projectIR", {}) or {},
            drop_target=payload.get("dropTargetFile"),
        )
    except Exception:
        print(json.dumps({
            "error": "internal resolver error: " + traceback.format_exc().splitlines()[-1],
            "rules": [], "best": None, "ambiguous": True, "candidates": [],
        }))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
