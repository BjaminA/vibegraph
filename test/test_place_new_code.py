"""
M15.1 — pin every rule in scripts/place_new_code.py's decision engine.

Coverage:
  Rule 1 (route_handler)  × 3 (happy + project-without-routes + no-decorator)
  Rule 2 (test_fixture)   × 3 (sibling + no-sibling + name-mismatch)
  Rule 3 (db_helper)      × 3 (calls-list happy + source-pattern happy +
                               below-threshold)
  Rule 4 (data_class)     × 2 (dataclass happy + Pydantic happy)
  Rule 5 (default)        × 1 (always returns drop_target with conf 0.5)
  Resolver behaviour      × 4 (best picks highest >= 0.7 / ambiguous
                               returns top-3 + default / dedupe /
                               threshold edge)

Run:
    PYTHONPATH=.pydeps:scripts python3 test/test_place_new_code.py -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / ".pydeps"))

import place_new_code as pnc  # noqa: E402


# A minimal flask_demo-like project IR for the tests.
def _project_ir(files: dict) -> dict:
    """Wraps {path: {nodes: [...]}} into the project envelope shape."""
    return {"version": "2.0", "files": files}


def _route_node(decorator: str) -> dict:
    return {"type": "function_def", "decorators": [decorator]}


# ── Rule 1: route_handler ───────────────────────────────────────────

class TestRouteHandler(unittest.TestCase):

    def test_route_decorator_in_source_routes_to_app_py(self):
        proj = _project_ir({
            "app.py": {"nodes": [_route_node("@app.route('/u1')"),
                                 _route_node("@app.route('/u2')")]},
            "cli.py": {"nodes": []},
        })
        r = pnc.place(
            source='@app.route("/foo")\ndef foo(): return 1\n',
            context={"newName": "foo"},
            project_ir=proj,
            drop_target="cli.py",
        )
        self.assertEqual(r["best"], {"rule": "route_handler", "file": "app.py"})
        self.assertFalse(r["ambiguous"])

    def test_route_decorator_with_no_existing_route_files_falls_below_threshold(self):
        proj = _project_ir({"cli.py": {"nodes": []}, "main.py": {"nodes": []}})
        r = pnc.place(
            source='@app.route("/foo")\ndef foo(): return 1\n',
            context={"newName": "foo"},
            project_ir=proj,
            drop_target="cli.py",
        )
        # Route rule fires at 0.55 (below 0.7), so we drop into the
        # ambiguous-prompt path.
        self.assertIsNone(r["best"])
        self.assertTrue(r["ambiguous"])

    def test_no_route_decorator_skips_rule_1(self):
        proj = _project_ir({"app.py": {"nodes": [_route_node("@app.route('/x')")]}})
        r = pnc.place(
            source="def foo(): return 1\n",
            context={"newName": "foo"},
            project_ir=proj,
            drop_target="cli.py",
        )
        # Falls to default → ambiguous (default's conf is 0.5).
        self.assertIsNone(r["best"])
        # Route rule confidence is 0 (it didn't match), so it's NOT in
        # candidates. Default IS.
        self.assertIn("cli.py", r["candidates"])


# ── Rule 2: test_fixture ────────────────────────────────────────────

class TestTestFixture(unittest.TestCase):

    def test_test_prefix_with_matching_sibling_test_file(self):
        proj = _project_ir({
            "cli.py": {"nodes": []},
            "test_cli.py": {"nodes": []},
        })
        r = pnc.place(
            source="def test_cli_smoke(): assert True\n",
            context={"newName": "test_cli_smoke"},
            project_ir=proj,
            drop_target="cli.py",
        )
        self.assertEqual(r["best"], {"rule": "test_fixture", "file": "test_cli.py"})

    def test_test_prefix_without_any_test_file_falls_below_threshold(self):
        proj = _project_ir({"cli.py": {"nodes": []}})
        r = pnc.place(
            source="def test_smoke(): assert True\n",
            context={"newName": "test_smoke"},
            project_ir=proj,
            drop_target="cli.py",
        )
        self.assertIsNone(r["best"])
        self.assertTrue(r["ambiguous"])

    def test_non_test_name_skips_rule_2(self):
        proj = _project_ir({"test_cli.py": {"nodes": []}})
        r = pnc.place(
            source="def helper(): return 1\n",
            context={"newName": "helper"},
            project_ir=proj,
            drop_target="cli.py",
        )
        # test_fixture's rule result has confidence 0.0 (no test_ prefix).
        rule_t = next(r2 for r2 in r["rules"] if r2["rule"] == "test_fixture")
        self.assertEqual(rule_t["confidence"], 0.0)


# ── Rule 3: db_helper ───────────────────────────────────────────────

class TestDbHelper(unittest.TestCase):

    def test_db_calls_list_routes_to_db_helper_file(self):
        proj = _project_ir({
            "db.py": {"nodes": [
                {"type": "function_def", "name": "_get_conn", "effectKind": "db"},
                {"type": "call", "effectKind": "db"},
            ]},
            "cli.py": {"nodes": []},
        })
        r = pnc.place(
            source="def helper():\n    conn.execute('SELECT 1')\n",
            context={"newName": "helper", "calls": ["conn.execute", "conn.commit"]},
            project_ir=proj,
            drop_target="cli.py",
        )
        self.assertEqual(r["best"], {"rule": "db_helper", "file": "db.py"})

    def test_db_source_pattern_when_calls_not_provided(self):
        proj = _project_ir({
            "db.py": {"nodes": [{"type": "call", "effectKind": "db"}]},
            "cli.py": {"nodes": []},
        })
        r = pnc.place(
            source="def helper():\n    cursor.execute('SELECT 1')\n    return cursor.fetchall()\n",
            context={"newName": "helper"},
            project_ir=proj,
            drop_target="cli.py",
        )
        # source has 2 DB-pattern matches; total calls (heuristic) = 2.
        # ratio 1.0 ≥ 0.5 → db_helper fires.
        self.assertEqual(r["best"], {"rule": "db_helper", "file": "db.py"})

    def test_non_db_calls_skip_rule_3(self):
        proj = _project_ir({"db.py": {"nodes": []}})
        r = pnc.place(
            source="def helper():\n    print('hi')\n    return 1\n",
            context={"calls": ["print", "len"]},
            project_ir=proj,
            drop_target="cli.py",
        )
        rule_d = next(r2 for r2 in r["rules"] if r2["rule"] == "db_helper")
        self.assertEqual(rule_d["confidence"], 0.0)


# ── Rule 4: data_class ──────────────────────────────────────────────

class TestDataClass(unittest.TestCase):

    def test_dataclass_decorator_routes_to_models_file(self):
        proj = _project_ir({
            "models.py": {"nodes": [
                {"type": "class_def", "name": "User",
                 "decorators": ["@dataclass"], "bases": []},
            ]},
            "cli.py": {"nodes": []},
        })
        r = pnc.place(
            source="@dataclass\nclass Post:\n    title: str\n    body: str\n",
            context={"newName": "Post"},
            project_ir=proj,
            drop_target="cli.py",
        )
        self.assertEqual(r["best"], {"rule": "data_class", "file": "models.py"})

    def test_pydantic_basemodel_routes_to_models_file(self):
        proj = _project_ir({
            "models.py": {"nodes": [
                {"type": "class_def", "name": "User",
                 "decorators": [], "bases": ["BaseModel"]},
            ]},
            "cli.py": {"nodes": []},
        })
        r = pnc.place(
            source="class Post(BaseModel):\n    title: str\n    body: str\n",
            context={"newName": "Post"},
            project_ir=proj,
            drop_target="cli.py",
        )
        self.assertEqual(r["best"], {"rule": "data_class", "file": "models.py"})


# ── Rule 5: default ──────────────────────────────────────────────────

class TestDefaultRule(unittest.TestCase):

    def test_default_always_present_with_drop_target(self):
        r = pnc.place(
            source="def helper(): pass\n",
            context={},
            project_ir=_project_ir({"cli.py": {"nodes": []}}),
            drop_target="cli.py",
        )
        rule_d = next(r2 for r2 in r["rules"] if r2["rule"] == "default")
        self.assertEqual(rule_d["file"], "cli.py")
        self.assertEqual(rule_d["confidence"], 0.5)

    def test_no_drop_target_yields_no_default_file(self):
        r = pnc.place(
            source="def helper(): pass\n",
            context={},
            project_ir=_project_ir({"cli.py": {"nodes": []}}),
            drop_target=None,
        )
        rule_d = next(r2 for r2 in r["rules"] if r2["rule"] == "default")
        self.assertIsNone(rule_d["file"])


# ── Resolver behaviour ──────────────────────────────────────────────

class TestResolver(unittest.TestCase):

    def test_resolver_picks_highest_confidence_rule(self):
        # Both route_handler and data_class could fire — only one
        # makes sense given the source. Sanity-check the ordering.
        proj = _project_ir({
            "app.py": {"nodes": [_route_node("@app.route('/x')")]},
            "models.py": {"nodes": [
                {"type": "class_def", "decorators": ["@dataclass"], "bases": []}
            ]},
        })
        r = pnc.place(
            source='@app.route("/foo")\ndef foo(): return 1\n',
            context={"newName": "foo"},
            project_ir=proj,
            drop_target="cli.py",
        )
        # route_handler at 0.95 beats data_class (which doesn't even
        # fire — no decorator/baseclass).
        self.assertEqual(r["best"]["rule"], "route_handler")

    def test_ambiguous_returns_top_candidates_with_default_appended(self):
        proj = _project_ir({"cli.py": {"nodes": []}, "main.py": {"nodes": []}})
        r = pnc.place(
            source="def foo(): pass\n",
            context={"newName": "foo"},
            project_ir=proj,
            drop_target="cli.py",
        )
        self.assertTrue(r["ambiguous"])
        self.assertIsNone(r["best"])
        # The default's file (cli.py) is in candidates.
        self.assertIn("cli.py", r["candidates"])

    def test_ambiguous_dedupes_candidates(self):
        # Multiple rules can return the same file. Candidates should
        # de-dupe while preserving order.
        proj = _project_ir({"cli.py": {"nodes": []}})
        r = pnc.place(
            source="def foo(): pass\n",
            context={"newName": "foo"},
            project_ir=proj,
            drop_target="cli.py",
        )
        # cli.py appears once.
        self.assertEqual(r["candidates"].count("cli.py"), 1)

    def test_threshold_edge_just_above_wins(self):
        # Inject a rule list with one rule that returns confidence
        # exactly 0.7 (the threshold). It should win because qualifying
        # is `>= 0.7`.
        original = pnc._PLACEMENT_RULES[:]
        try:
            def _exactly_threshold(source, context, project_ir, drop):
                return {"file": "exact.py", "confidence": 0.7, "reason": "edge"}
            pnc._PLACEMENT_RULES.insert(0, ("exact_thresh", _exactly_threshold))
            r = pnc.place(
                source="def foo(): pass\n",
                context={"newName": "foo"},
                project_ir=_project_ir({"cli.py": {"nodes": []}}),
                drop_target="cli.py",
            )
            self.assertEqual(r["best"], {"rule": "exact_thresh", "file": "exact.py"})
        finally:
            pnc._PLACEMENT_RULES[:] = original


# ── Output shape sanity ──────────────────────────────────────────────

class TestOutputShape(unittest.TestCase):

    def test_every_call_returns_required_keys(self):
        r = pnc.place(
            source="def helper(): pass\n",
            context={},
            project_ir=_project_ir({"cli.py": {"nodes": []}}),
            drop_target="cli.py",
        )
        self.assertIn("rules", r)
        self.assertIn("best", r)
        self.assertIn("ambiguous", r)
        self.assertIn("candidates", r)
        for rr in r["rules"]:
            self.assertIn("rule", rr)
            self.assertIn("file", rr)
            self.assertIn("confidence", rr)
            self.assertIn("reason", rr)

    def test_resolver_never_raises_on_empty_project(self):
        r = pnc.place(
            source="def helper(): pass\n",
            context={},
            project_ir={"files": {}},
            drop_target=None,
        )
        self.assertIsInstance(r, dict)


if __name__ == "__main__":
    unittest.main()
