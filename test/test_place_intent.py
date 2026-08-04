"""
M18.4 — pin every rule in scripts/place_intent.py's heuristic engine.

Each rule emits a valid { op, target_id, source } tuple for its canonical
intent; non-matching intents return no proposal (→ Tier 2 LLM); rename is
explicitly rejected. Covers the dispatch threshold + priority ordering too.

Run:
    PYTHONPATH=.pydeps:scripts python3 test/test_place_intent.py -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / ".pydeps"))

import place_intent as pi  # noqa: E402


# A cli.py:main-like neighbourhood: a function with a couple assignments
# and a call inside it, plus a module-level import.
NODES = [
    {"id": "module/argparse.import", "type": "import", "parentId": None},
    {"id": "module/main.fn", "type": "function_def", "name": "main", "parentId": None},
    {"id": "module/main.fn/create.assign", "type": "assignment", "name": "create", "parentId": "module/main.fn"},
    {"id": "module/main.fn/print.call", "type": "call", "funcName": "print", "parentId": "module/main.fn"},
]
CTX = {
    "nodes": NODES,
    "filePath": "cli.py",
    "enclosingFunctionSource": "def main():\n    x = 1\n    return x\n",
}
# Selected node = the call inside main (the common "I clicked a statement" case).
TARGET_CALL = {"id": "module/main.fn/print.call", "type": "call", "parentId": "module/main.fn"}
TARGET_FN = {"id": "module/main.fn", "type": "function_def", "parentId": None}

# Op names place_intent may emit (cst_rewrite.py contract + the sentinel).
VALID_OPS = {
    "replace_node", "insert_before", "insert_after", "append_end", "delete_node",
    "rename_in_scope", "insert_as_first_child", "insert_as_last_child",
    "append_positional_arg", "append_keyword_arg", "add_function_parameter",
    "replace_function_body", "replace_module_body", "rejected",
}


def _place(intent, target=TARGET_CALL, ctx=CTX):
    return pi.place(intent, target, ctx)


class TestRules(unittest.TestCase):

    def test_add_argument_to_named_receiver(self):
        p = _place("add a verbose argument to the create subparser")["proposal"]
        self.assertEqual(p["op"], "append_keyword_arg")
        self.assertEqual(p["target_id"], "module/main.fn/create.assign")
        self.assertEqual(p["source"], "verbose=None")

    def test_add_argument_falls_back_to_enclosing_call(self):
        p = _place("add a timeout argument")["proposal"]
        self.assertEqual(p["op"], "append_keyword_arg")
        self.assertEqual(p["target_id"], "module/main.fn/print.call")
        self.assertEqual(p["source"], "timeout=None")

    def test_add_parameter_targets_enclosing_function(self):
        p = _place("add a verbose parameter")["proposal"]
        self.assertEqual(p["op"], "add_function_parameter")
        self.assertEqual(p["target_id"], "module/main.fn")
        self.assertEqual(p["source"], "verbose")

    def test_add_import_for_module(self):
        p = _place("add an import for os")["proposal"]
        self.assertEqual(p["op"], "insert_before")
        self.assertEqual(p["target_id"], "module/argparse.import")  # first top-level node
        self.assertEqual(p["source"], "import os")

    def test_add_import_X_import_phrasing(self):
        p = _place("add a json import")["proposal"]
        self.assertEqual(p["op"], "insert_before")
        self.assertEqual(p["source"], "import json")

    def test_add_return_with_expr(self):
        p = _place("add a return result")["proposal"]
        self.assertEqual(p["op"], "insert_as_last_child")
        self.assertEqual(p["target_id"], "module/main.fn")
        self.assertEqual(p["source"], "return result")

    def test_add_return_defaults_to_none(self):
        p = _place("add a return")["proposal"]
        self.assertEqual(p["op"], "insert_as_last_child")
        self.assertEqual(p["source"], "return None")

    def test_add_docstring(self):
        p = _place("add a docstring")["proposal"]
        self.assertEqual(p["op"], "insert_as_first_child")
        self.assertEqual(p["target_id"], "module/main.fn")
        self.assertIn('"""', p["source"])

    def test_add_print(self):
        p = _place("add a print here")["proposal"]
        self.assertEqual(p["op"], "insert_after")
        self.assertEqual(p["target_id"], "module/main.fn/print.call")
        self.assertIn("print(", p["source"])

    def test_add_log_distinct_from_print(self):
        p = _place("add a log line")["proposal"]
        self.assertEqual(p["op"], "insert_after")
        self.assertIn("logging.", p["source"])

    def test_add_raise(self):
        p = _place("raise a ValueError if bad")["proposal"]
        self.assertEqual(p["op"], "insert_after")
        self.assertTrue(p["source"].startswith("raise ValueError"))

    def test_add_if(self):
        p = _place("add an if guard")["proposal"]
        self.assertEqual(p["op"], "insert_after")
        self.assertIn("if True:", p["source"])
        self.assertIn("pass", p["source"])

    def test_wrap_in_try_builds_replace_function_body(self):
        p = _place("wrap this in a try except")["proposal"]
        self.assertEqual(p["op"], "replace_function_body")
        self.assertEqual(p["target_id"], "module/main.fn")
        self.assertIn("try:", p["source"])
        self.assertIn("except Exception:", p["source"])

    def test_wrap_try_without_function_source_does_not_match(self):
        ctx = {**CTX, "enclosingFunctionSource": None}
        result = _place("wrap this in try", TARGET_CALL, ctx)
        # No other rule matches "wrap ... try", so nothing fires.
        self.assertFalse(result["matched"])
        self.assertIsNone(result["proposal"])

    def test_rename_is_rejected(self):
        p = _place("rename main to run")["proposal"]
        self.assertEqual(p["op"], "rejected")
        self.assertTrue(p["rejected"])

    def test_rename_wins_on_priority_over_other_verbs(self):
        # rename is the highest-priority rule; it should claim the intent
        # even when a lower-priority keyword (print) is also present.
        p = _place("rename main to run and add a print")["proposal"]
        self.assertEqual(p["op"], "rejected")


class TestDispatch(unittest.TestCase):

    def test_gibberish_returns_no_proposal(self):
        result = _place("make it faster somehow")
        self.assertFalse(result["matched"])
        self.assertIsNone(result["proposal"])
        self.assertEqual(result["candidates"], [])

    def test_all_emitted_ops_are_valid(self):
        intents = [
            "add a verbose argument to the create subparser",
            "add a timeout parameter",
            "add an import for os",
            "add a return value",
            "add a docstring",
            "add a print",
            "add a log",
            "raise a ValueError",
            "add an if",
            "wrap this in a try except",
            "rename main to run",
        ]
        for intent in intents:
            result = _place(intent)
            self.assertTrue(result["matched"], f"expected a match for: {intent}")
            self.assertIn(result["proposal"]["op"], VALID_OPS, f"invalid op for: {intent}")
            # Non-rejected proposals must carry a target id.
            if not result["proposal"]["rejected"]:
                self.assertIsNotNone(result["proposal"]["target_id"], f"no target for: {intent}")

    def test_proposal_tuple_shape(self):
        p = _place("add a print")["proposal"]
        for key in ("op", "target_id", "source", "confidence", "reason", "rejected"):
            self.assertIn(key, p)
        self.assertIsInstance(p["confidence"], float)


if __name__ == "__main__":
    unittest.main()
