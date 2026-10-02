"""LITERAL TABLES for Python (2026-10-02) — the counterpart of
scripts/frontends/jsts/literal_table.mjs, same shapes, same value encoding.

A module-level constant whose value is DATA (a list of dicts, a dict of dicts,
a dict of plain values, a list of plain literals) is lifted verbatim onto its
assignment node as `table`, so a catalogue, a route table or a transition
table is in the IR as rows rather than an 80-character preview. Nothing is
interpreted here.

    rows    [{"path": ..., "write": [...]}, ...]
    record  {"Q1": {"yes": ..., "no": ...}, ...}   /  {"a": "x", ...}
    list    ["a", "b"]
"""
from __future__ import annotations

import ast
from typing import Callable, Optional

import libcst as cst

MAX_ROWS = 400
MAX_FIELDS = 40
MAX_STR = 300
MAX_DEPTH = 4
MIN_ENTRIES = 2

Code = Callable[[cst.CSTNode], str]
Line = Callable[[cst.CSTNode], int]


def _clip(s: str) -> str:
    return s if len(s) <= MAX_STR else s[: MAX_STR - 1] + "…"


def _string(n: cst.BaseExpression, code: Code) -> Optional[str]:
    if isinstance(n, (cst.SimpleString, cst.ConcatenatedString)):
        try:
            v = ast.literal_eval(code(n))
            return _clip(v) if isinstance(v, str) else None
        except (ValueError, SyntaxError):
            return None
    return None


def _scalar(n: cst.BaseExpression, code: Code) -> bool:
    if _string(n, code) is not None or isinstance(n, (cst.Integer, cst.Float)):
        return True
    return isinstance(n, cst.Name) and n.value in ("True", "False", "None")


def value(n: cst.BaseExpression, code: Code, line: Line, depth: int = 0):
    s = _string(n, code)
    if s is not None:
        return s
    if isinstance(n, cst.Integer):
        try:
            return int(n.value.replace("_", ""), 0)
        except ValueError:
            return {"expr": n.value}
    if isinstance(n, cst.Float):
        try:
            return float(n.value.replace("_", ""))
        except ValueError:
            return {"expr": n.value}
    if isinstance(n, cst.Name):
        literals = {"True": True, "False": False, "None": None}
        return literals[n.value] if n.value in literals else {"ref": n.value}
    if isinstance(n, cst.Attribute):
        return {"ref": code(n)}
    if isinstance(n, cst.UnaryOperation) and isinstance(n.operator, cst.Minus) and isinstance(n.expression, (cst.Integer, cst.Float)):
        v = value(n.expression, code, line, depth)
        return -v if isinstance(v, (int, float)) else {"expr": _clip(code(n))}
    if isinstance(n, cst.Lambda):
        return {"fn": line(n)}
    if isinstance(n, (cst.List, cst.Tuple, cst.Set)):
        if depth >= MAX_DEPTH:
            return {"expr": _clip(code(n))}
        out = []
        for el in list(n.elements)[:MAX_ROWS]:
            out.append({"spread": code(el.value)} if isinstance(el, cst.StarredElement) else value(el.value, code, line, depth + 1))
        return out
    if isinstance(n, cst.Dict):
        if depth >= MAX_DEPTH:
            return {"expr": _clip(code(n))}
        return {"fields": fields(n, code, line, depth + 1)}
    return {"expr": _clip(code(n))}


def _key(k: cst.BaseExpression, code: Code) -> Optional[str]:
    s = _string(k, code)
    if s is not None:
        return s
    if isinstance(k, (cst.Integer, cst.Float)):
        return k.value
    return f"[{code(k)}]"


def fields(d: cst.Dict, code: Code, line: Line, depth: int = 1) -> dict:
    out: dict = {}
    for el in d.elements:
        if len(out) >= MAX_FIELDS:
            break
        if isinstance(el, cst.DictElement):
            out[_key(el.key, code)] = value(el.value, code, line, depth)
        elif isinstance(el, cst.StarredDictElement):
            out[f"...{code(el.value)}"] = {"spread": True}
    return out


def literal_table(n: cst.BaseExpression, code: Code, line: Line) -> Optional[dict]:
    """The table a module-level constant holds, or None."""
    if isinstance(n, (cst.List, cst.Tuple)):
        els = [e for e in n.elements if isinstance(e, cst.Element)]
        if len(els) < MIN_ENTRIES or len(els) != len(n.elements):
            return None
        if all(isinstance(e.value, cst.Dict) for e in els):
            rows = [{"line": line(e.value), "fields": fields(e.value, code, line)} for e in els[:MAX_ROWS]]
            return {"shape": "rows", "rows": rows, **({"truncated": len(els)} if len(els) > MAX_ROWS else {})}
        if all(_scalar(e.value, code) for e in els):
            return {"shape": "list", "values": [value(e.value, code, line) for e in els[:MAX_ROWS]]}
        return None
    if isinstance(n, cst.Dict):
        els = list(n.elements)
        if len(els) < MIN_ENTRIES or not all(isinstance(e, cst.DictElement) for e in els):
            return None
        rows = []
        for e in els[:MAX_ROWS]:
            key = _key(e.key, code)
            if isinstance(e.value, cst.Dict):
                rows.append({"key": key, "line": line(e), "fields": fields(e.value, code, line)})
            else:
                rows.append({"key": key, "line": line(e), "value": value(e.value, code, line)})
        return {"shape": "record", "rows": rows, **({"truncated": len(els)} if len(els) > MAX_ROWS else {})}
    return None


# ── NAME PATTERNS (module 2): the counterpart of jsts/name_pattern.mjs ─────


def _root_name(n: cst.BaseExpression) -> Optional[str]:
    for _ in range(12):
        if isinstance(n, cst.Name):
            return n.value
        if isinstance(n, cst.Call):
            n = n.func
        elif isinstance(n, cst.Attribute):
            n = n.value
        elif isinstance(n, cst.Subscript):
            n = n.value
        else:
            return None
    return None


def _piece(n, params: list, code: Code, transforms: dict) -> Optional[str]:
    s = _string(n, code)
    if s is not None:
        return s.replace("{", "").replace("}", "")
    if isinstance(n, cst.Name):
        return "{" + n.value + "}" if n.value in params else None
    if isinstance(n, cst.FormattedString):
        out = ""
        for part in n.parts:
            if isinstance(part, cst.FormattedStringText):
                out += part.value.replace("{{", "").replace("}}", "")
            elif isinstance(part, cst.FormattedStringExpression):
                p = _piece(part.expression, params, code, transforms)
                if p is None:
                    return None
                out += p
            else:
                return None
        return out
    if isinstance(n, cst.BinaryOperation) and isinstance(n.operator, cst.Add):
        left = _piece(n.left, params, code, transforms)
        right = _piece(n.right, params, code, transforms)
        return None if left is None or right is None else left + right
    if isinstance(n, (cst.Call, cst.Attribute)):
        root = _root_name(n)
        if root in params:
            transforms[root] = code(n)[len(root):]
            return "{" + root + "}"
    return None


def name_pattern(fn: cst.FunctionDef, code: Code) -> Optional[dict]:
    """The pattern a function whose whole body returns an f-string, a string
    concatenation or a literal of its parameters builds, or None."""
    params = [p.name.value for p in fn.params.params if p.name.value not in ("self", "cls")]
    if not params or not isinstance(fn.body, cst.IndentedBlock):
        return None
    stmts = list(fn.body.body)
    if stmts and isinstance(stmts[0], cst.SimpleStatementLine) and len(stmts[0].body) == 1             and isinstance(stmts[0].body[0], cst.Expr) and _string(stmts[0].body[0].value, code) is not None:
        stmts = stmts[1:]
    if len(stmts) != 1 or not isinstance(stmts[0], cst.SimpleStatementLine) or len(stmts[0].body) != 1:
        return None
    ret = stmts[0].body[0]
    if not isinstance(ret, cst.Return) or ret.value is None:
        return None
    if not isinstance(ret.value, (cst.FormattedString, cst.BinaryOperation, cst.SimpleString, cst.ConcatenatedString)):
        return None
    transforms: dict = {}
    p = _piece(ret.value, params, code, transforms)
    if p is None or "{" not in p:
        return None
    out = {"pattern": p, "params": params}
    if transforms:
        out["transformed"] = sorted(transforms)
        out["chains"] = transforms
    return out
