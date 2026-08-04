"""
Tests for scripts/check_literals.py — the M-RUN SM2 literal-only validation
chokepoint. Synthesized args become EXECUTED source, so this allowlist is a
safety boundary: it must accept pure literals and reject anything that could
execute code (calls, names, attribute access, f-strings, comprehensions, …).

Run with:
    PYTHONPATH=.pydeps python3 -m unittest test.test_check_literals -v
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "check_literals.py"
PYDEPS = ROOT / ".pydeps"


def run(args: dict) -> dict:
    env = {"PYTHONPATH": str(PYDEPS)}
    import os
    env = {**os.environ, "PYTHONPATH": f"{PYDEPS}:{os.environ.get('PYTHONPATH', '')}"}
    p = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps({"args": args}),
                       capture_output=True, text=True, env=env)
    assert p.returncode == 0, f"script failed: {p.stderr}"
    return json.loads(p.stdout)


def run_instance(cls, args: dict) -> dict:
    import os
    env = {**os.environ, "PYTHONPATH": f"{PYDEPS}:{os.environ.get('PYTHONPATH', '')}"}
    p = subprocess.run([sys.executable, str(SCRIPT), "--mode", "instance"],
                       input=json.dumps({"class": cls, "args": args}),
                       capture_output=True, text=True, env=env)
    assert p.returncode == 0, f"script failed: {p.stderr}"
    return json.loads(p.stdout)


class AcceptsLiterals(unittest.TestCase):
    def test_scalars_bools_none(self):
        r = run({"a": "42", "b": "-3.5", "c": "'hi'", "d": "True", "e": "None", "f": "False"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["accepted"]["a"], "42")
        self.assertEqual(r["accepted"]["e"], "None")

    def test_collections_nested(self):
        r = run({"xs": "[1, 2, 3]", "d": "{'k': [1, -2], 'j': (True, None)}", "s": "{1, 2}"})
        self.assertTrue(r["ok"], r)

    def test_implicit_string_concat(self):
        r = run({"s": "'foo' 'bar'"})
        self.assertTrue(r["ok"], r)

    def test_assembled_call_is_keyword_form(self):
        r = run({"n": "10", "label": "'x'"})
        self.assertTrue(r["ok"])
        self.assertEqual(r["call"], "n=10, label='x'")


class RejectsCode(unittest.TestCase):
    def _assert_rejected(self, expr):
        r = run({"p": expr})
        self.assertFalse(r["ok"], f"{expr!r} should be rejected but passed: {r}")
        self.assertEqual(r["call"], "")
        self.assertEqual(len(r["rejected"]), 1)

    def test_call(self):
        self._assert_rejected("open('/etc/passwd')")

    def test_bare_name(self):
        self._assert_rejected("some_var")

    def test_attribute(self):
        self._assert_rejected("os.environ")

    def test_subscript(self):
        self._assert_rejected("d['k']")

    def test_fstring(self):
        self._assert_rejected("f'{x}'")

    def test_comprehension(self):
        self._assert_rejected("[i for i in range(3)]")

    def test_lambda(self):
        self._assert_rejected("lambda: 1")

    def test_walrus(self):
        self._assert_rejected("(x := 5)")

    def test_binop_is_not_a_plain_literal(self):
        # 1 + 1 has a BinaryOperation node — not in the allowlist. Honest refusal.
        self._assert_rejected("1 + 1")

    def test_call_hidden_in_collection(self):
        # The injection danger: a call buried inside an otherwise-literal list.
        r = run({"p": "[1, open('x'), 3]"})
        self.assertFalse(r["ok"], r)


class AllOrNothing(unittest.TestCase):
    def test_one_bad_arg_fails_whole_set(self):
        r = run({"good": "1", "bad": "evil()"})
        self.assertFalse(r["ok"])
        self.assertEqual(r["call"], "")  # no partial call assembled
        self.assertIn("bad", [x["param"] for x in r["rejected"]])

    def test_bad_param_name_rejected(self):
        r = run({"not-an-ident": "1"})
        self.assertFalse(r["ok"])

    def test_empty_args_is_ok_empty_call(self):
        r = run({})
        self.assertTrue(r["ok"])
        self.assertEqual(r["call"], "")


class InstanceMode(unittest.TestCase):
    """M-RUN2.1 — `--mode instance` validates exactly ClassName(<literal
    kwargs>). A NEW mode: the literal allowlist itself is shared, unwidened;
    the only extra token permitted is the single plain-identifier class."""

    def test_constructor_with_literal_args(self):
        r = run_instance("Gauge", {"scale": "2", "label": "'volts'"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["call"], "Gauge(scale=2, label='volts')")

    def test_all_defaults_constructor(self):
        r = run_instance("SignalNet", {})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["call"], "SignalNet()")

    def test_dotted_class_name_rejected(self):
        r = run_instance("os.path", {})
        self.assertFalse(r["ok"])

    def test_call_shaped_class_name_rejected(self):
        r = run_instance("Gauge()", {})
        self.assertFalse(r["ok"])

    def test_literal_keyword_class_name_rejected(self):
        r = run_instance("None", {})
        self.assertFalse(r["ok"])

    def test_non_literal_ctor_arg_rejects_whole_instance(self):
        r = run_instance("Gauge", {"scale": "2", "path": "os.environ['X']"})
        self.assertFalse(r["ok"])
        self.assertEqual(r["call"], "")

    def test_fstring_ctor_arg_rejected(self):
        r = run_instance("Gauge", {"label": "f'{x}'"})
        self.assertFalse(r["ok"])


if __name__ == "__main__":
    unittest.main()
