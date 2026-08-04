#!/usr/bin/env python3
"""
Literal-only validation chokepoint for M-RUN SM2 (synthesized inputs).

SM2 lets Claude synthesize arguments for an entry function so "run to this
node" can reach a node behind a parameter. Those synthesized argument
expressions are SPLICED INTO EXECUTED PYTHON SOURCE (server.ts
runThreadToNodeCore, the `<entryFn>(...)` scaffold). That is a code-
injection surface the no-arg harness never had — so every synthesized arg
must pass a tight allowlist BEFORE it can be injected. This is the SM2
analogue of the M2 format-and-diff chokepoint: never widen it casually.

ALLOWED (pure literals only): int / float / imaginary, strings (incl.
implicit concatenation), True / False / None, and list / tuple / set /
dict whose elements are themselves allowed, and unary +/-/~ on a number.

REJECTED (everything else): calls, names (other than the three literal
keywords), attribute/subscript access, f-strings, lambdas, comprehensions,
comparisons, boolean/conditional expressions, await, walrus, etc. An arg
that needs any of those is honestly refused — the run does not happen with
an unvalidated value. (A later tier may widen this deliberately, with its
own guard; the default stays literal-only.)

We use libcst (the project parser — NOT stdlib ast, NOT a regex) so the
allowlist is structural and cannot be fooled by formatting.

Pipeline (default mode):
  stdin  : {"args": {"<paramName>": "<exprString>", ...}}
  stdout : {"ok": bool,
            "call": "<p1>=<e1>, <p2>=<e2>",   # validated keyword-arg string
            "accepted": {param: expr, ...},
            "rejected": [{"param":..., "expr":..., "reason":...}, ...]}
  ok is True iff EVERY arg validated (all-or-nothing: a partial call would
  run with some made-up and some missing args — refuse the whole run).

--mode instance (M-RUN2.1 — synthesized example instances):
  Validates exactly the shape `ClassName(<literal kwargs>)` so a made-up
  instance construction can be injected. This is a NEW mode, not a widening
  of the default: the literal allowlist above is reused unchanged for the
  constructor arguments, and the ONLY extra thing permitted is the single
  class name — a plain identifier, nothing dotted, nothing called twice.
  stdin  : {"class": "<ClassName>", "args": {"<param>": "<exprString>", ...}}
  stdout : {"ok": bool,
            "call": "ClassName(<p1>=<e1>, ...)",  # validated constructor call
            "accepted": {...}, "rejected": [...]}
"""

import argparse
import json
import re
import sys

import libcst as cst

_IDENT = re.compile(r"^[A-Za-z_]\w*$")
_LITERAL_KEYWORDS = frozenset({"True", "False", "None"})
_MAX_EXPR_LEN = 2000  # a synthesized literal longer than this is suspicious
_MAX_ARGS = 32

# Expression nodes permitted directly. Collection elements (Element /
# DictElement) and structural tokens are not BaseExpression and are walked
# through transparently; their child expressions are still checked.
_ALLOWED_LEAF = (
    cst.Integer, cst.Float, cst.Imaginary,
    cst.SimpleString, cst.ConcatenatedString,
    cst.List, cst.Tuple, cst.Set, cst.Dict,
)
_ALLOWED_UNARY_OPS = (cst.Minus, cst.Plus, cst.BitInvert)


class _LiteralChecker(cst.CSTVisitor):
    """Flags any BaseExpression node outside the literal allowlist."""

    def __init__(self) -> None:
        self.violation: str | None = None

    def on_visit(self, node: cst.CSTNode) -> bool:
        if self.violation is not None:
            return False  # already failed — stop walking
        if isinstance(node, cst.BaseExpression) and not self._allowed(node):
            self.violation = type(node).__name__
            return False
        return True

    def _allowed(self, node: cst.BaseExpression) -> bool:
        if isinstance(node, cst.Name):
            return node.value in _LITERAL_KEYWORDS
        if isinstance(node, cst.UnaryOperation):
            return isinstance(node.operator, _ALLOWED_UNARY_OPS)
        return isinstance(node, _ALLOWED_LEAF)


def _validate_expr(expr: str) -> str | None:
    """Return None if `expr` is a pure literal, else a human reason."""
    if not expr or not expr.strip():
        return "empty expression"
    if len(expr) > _MAX_EXPR_LEN:
        return f"expression too long ({len(expr)} > {_MAX_EXPR_LEN})"
    try:
        tree = cst.parse_expression(expr)
    except Exception as e:  # libcst parse error → not a usable expression
        return f"not a parseable expression: {e}"
    checker = _LiteralChecker()
    tree.visit(checker)
    if checker.violation is not None:
        return f"non-literal node: {checker.violation}"
    return None


def _validate_args(args: dict) -> tuple[dict, list]:
    """Shared literal validation of an args map → (accepted, rejected)."""
    accepted: dict = {}
    rejected: list = []
    for param, expr in args.items():
        if not isinstance(param, str) or not _IDENT.match(param):
            rejected.append({"param": param, "expr": expr,
                             "reason": "parameter name is not a plain identifier"})
            continue
        if not isinstance(expr, str):
            rejected.append({"param": param, "expr": expr,
                             "reason": "value expression must be a string"})
            continue
        reason = _validate_expr(expr)
        if reason is not None:
            rejected.append({"param": param, "expr": expr, "reason": reason})
            continue
        accepted[param] = expr.strip()
    return accepted, rejected


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["args", "instance"], default="args")
    mode = ap.parse_args().mode
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "call": "", "accepted": {},
                          "rejected": [{"param": None, "expr": None,
                                        "reason": f"bad JSON: {e}"}]}))
        return

    if mode == "instance":
        # M-RUN2.1 — validate `ClassName(<literal kwargs>)`. The class name is
        # the single permitted non-literal token: a plain identifier that is
        # not a literal keyword. Everything else goes through the SAME
        # literal gate as default mode — never widened.
        cls = payload.get("class")
        args = payload.get("args") or {}
        if (not isinstance(cls, str) or not _IDENT.match(cls)
                or cls in _LITERAL_KEYWORDS):
            print(json.dumps({"ok": False, "call": "", "accepted": {},
                              "rejected": [{"param": None, "expr": cls,
                                            "reason": "class name must be a plain identifier"}]}))
            return
        if not isinstance(args, dict) or len(args) > _MAX_ARGS:
            print(json.dumps({"ok": False, "call": "", "accepted": {},
                              "rejected": [{"param": None, "expr": None,
                                            "reason": "args must be an object (bounded)"}]}))
            return
        accepted, rejected = _validate_args(args)
        ok = len(rejected) == 0 and len(accepted) == len(args)
        call = f"{cls}({', '.join(f'{p}={e}' for p, e in accepted.items())})" if ok else ""
        print(json.dumps({"ok": ok, "call": call, "accepted": accepted, "rejected": rejected}))
        return

    args = payload.get("args") or {}
    if not isinstance(args, dict):
        print(json.dumps({"ok": False, "call": "", "accepted": {},
                          "rejected": [{"param": None, "expr": None,
                                        "reason": "args must be an object"}]}))
        return
    if len(args) > _MAX_ARGS:
        print(json.dumps({"ok": False, "call": "", "accepted": {},
                          "rejected": [{"param": None, "expr": None,
                                        "reason": f"too many args ({len(args)})"}]}))
        return

    accepted, rejected = _validate_args(args)

    # All-or-nothing: a partial arg set would run with some args missing,
    # producing a TypeError or a misleading result. Only a fully-validated
    # set is usable.
    ok = len(rejected) == 0 and len(accepted) == len(args)
    call = ", ".join(f"{p}={e}" for p, e in accepted.items()) if ok else ""
    print(json.dumps({"ok": ok, "call": call, "accepted": accepted, "rejected": rejected}))


if __name__ == "__main__":
    main()
