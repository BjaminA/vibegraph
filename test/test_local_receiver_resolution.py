"""
Tests for the M17.1 local-variable receiver resolution path in
scripts/cross_file_link.py.

Before M17.1, a method call like ``parser.add_subparsers()`` where
``parser = argparse.ArgumentParser(...)`` three lines up rendered as
"External call — source not resolvable / No module named 'parser'".
The resolver only consulted the import map; local assignments were
ignored.

After M17.1, cross_file_link emits a v1.4 reference edge whose
``target`` is the receiver's assignment node (same file),
``qualifiedTarget`` resolves through the local binding to the external
or project symbol (e.g. ``argparse:ArgumentParser.add_subparsers``),
and ``viaLocal`` records the receiver name.

Run:
    PYTHONPATH=.pydeps python3 -m unittest test.test_local_receiver_resolution -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import cross_file_link  # noqa: E402


# ─────────────────────────────────────────── helpers ─────────────────

def _make_ir(module_path: str, nodes: list, edges: list = None) -> dict:
    """Build the minimal per-file IR shape the linker consumes.

    The linker only reads `modulePath`, `nodes`, and `edges`. It doesn't
    need symbolIndex or version. We construct hand-rolled IRs to exercise
    specific node shapes without running libcst.
    """
    return {
        "version": "1.3",
        "modulePath": module_path,
        "nodes": nodes,
        "edges": edges or [],
        "symbolIndex": [],
    }


def _assign(node_id: str, name: str, call_target: str, parent_id=None) -> dict:
    """A call-RHS assignment node (the shape parse_cst emits for
    ``x = foo(...)``). ``parent_id`` is None for module-scope, or the
    enclosing function_def's id for in-function assignments."""
    return {
        "id": node_id,
        "type": "assignment",
        "parentId": parent_id,
        "line": 1, "endLine": 1, "col": 0, "endCol": 1,
        "name": name,
        "valueKind": "call",
        "callTarget": call_target,
        "preview": f"{call_target}(...)",
    }


def _call(node_id: str, func_name: str, parent_id=None) -> dict:
    return {
        "id": node_id,
        "type": "call",
        "parentId": parent_id,
        "line": 1, "endLine": 1, "col": 0, "endCol": 1,
        "funcName": func_name,
        "args": [],
        "isEffect": False,
    }


def _fn(node_id: str, name: str, parent_id=None, returns=None) -> dict:
    return {
        "id": node_id,
        "type": "function_def",
        "parentId": parent_id,
        "line": 1, "endLine": 10, "col": 0, "endCol": 1,
        "name": name,
        "params": [],
        "docstring": None,
        "decorators": [],
        "isAsync": False,
        "returns": returns,
    }


def _class(node_id: str, name: str, parent_id=None) -> dict:
    return {
        "id": node_id,
        "type": "class_def",
        "parentId": parent_id,
        "line": 1, "endLine": 5, "col": 0, "endCol": 1,
        "name": name,
        "bases": [],
        "decorators": [],
    }


def _import(node_id: str, name: str, parent_id=None) -> dict:
    return {
        "id": node_id,
        "type": "import",
        "parentId": parent_id,
        "line": 1, "endLine": 1, "col": 0, "endCol": 1,
        "names": [name],
    }


def _import_from(node_id: str, module: str, name: str, parent_id=None) -> dict:
    return {
        "id": node_id,
        "type": "import_from",
        "parentId": parent_id,
        "line": 1, "endLine": 1, "col": 0, "endCol": 1,
        "module": module,
        "names": [name],
    }


def _via_local_edges(edges: list) -> list:
    return [e for e in edges if "viaLocal" in e]


# ─────────────────────────────────────────── tests ───────────────────

class TestArgparseReceiver(unittest.TestCase):
    """The canonical argparse case from the flask_demo fixture:
    ``parser = argparse.ArgumentParser(); parser.add_subparsers()``."""

    def test_emits_via_local_edge_for_method_on_argparse_parser(self):
        # def main():
        #     parser = argparse.ArgumentParser()
        #     parser.add_subparsers()
        fn = _fn("module/main.fn", "main")
        parser_assign = _assign(
            "module/main.fn/parser.assign", "parser",
            "argparse.ArgumentParser", parent_id="module/main.fn",
        )
        sub_assign = _assign(
            "module/main.fn/sub.assign", "sub",
            "parser.add_subparsers", parent_id="module/main.fn",
        )
        imp = _import("module/argparse.import", "argparse")
        ir = _make_ir("cli", [imp, fn, parser_assign, sub_assign])
        out = cross_file_link.link({"/cli.py": ir})
        edges = _via_local_edges(out["/cli.py"]["edges"])
        self.assertEqual(len(edges), 1, edges)
        e = edges[0]
        self.assertEqual(e["source"], "module/main.fn/sub.assign")
        self.assertEqual(e["target"], "module/main.fn/parser.assign")
        self.assertEqual(e["type"], "reference")
        # viaLocal edges are intra-file: targetFile absent per schema.
        self.assertNotIn("targetFile", e)
        self.assertEqual(e["qualifiedTarget"], "argparse:ArgumentParser.add_subparsers")
        self.assertEqual(e["viaLocal"], "parser")

    def test_ir_version_bumps_to_1_4_when_via_local_emitted(self):
        fn = _fn("module/main.fn", "main")
        parser_assign = _assign(
            "module/main.fn/parser.assign", "parser",
            "argparse.ArgumentParser", parent_id="module/main.fn",
        )
        sub_assign = _assign(
            "module/main.fn/sub.assign", "sub",
            "parser.add_subparsers", parent_id="module/main.fn",
        )
        imp = _import("module/argparse.import", "argparse")
        ir = _make_ir("cli", [imp, fn, parser_assign, sub_assign])
        out = cross_file_link.link({"/cli.py": ir})
        self.assertEqual(out["/cli.py"]["version"], "1.4")


class TestRequestsSession(unittest.TestCase):
    """from requests import Session; s = Session(); s.get(url)."""

    def test_session_method_resolves_via_local(self):
        fn = _fn("module/fetch.fn", "fetch")
        s_assign = _assign(
            "module/fetch.fn/s.assign", "s",
            "Session", parent_id="module/fetch.fn",
        )
        get_call = _call(
            "module/fetch.fn/call@0", "s.get",
            parent_id="module/fetch.fn",
        )
        imp = _import_from("module/requests.import_from", "requests", "Session")
        ir = _make_ir("fetcher", [imp, fn, s_assign, get_call])
        out = cross_file_link.link({"/fetcher.py": ir})
        edges = _via_local_edges(out["/fetcher.py"]["edges"])
        self.assertEqual(len(edges), 1, edges)
        self.assertEqual(edges[0]["qualifiedTarget"], "requests:Session.get")
        self.assertEqual(edges[0]["viaLocal"], "s")
        self.assertEqual(edges[0]["target"], "module/fetch.fn/s.assign")


class TestUnknownReceiver(unittest.TestCase):
    """Receiver that is neither a local assignment nor an import — must
    fall through to the existing 'external' classification (no edge)."""

    def test_unknown_receiver_emits_no_via_local_edge(self):
        fn = _fn("module/handler.fn", "handler")
        # No assignment binding `mystery`.
        call = _call(
            "module/handler.fn/call@0", "mystery.do_thing",
            parent_id="module/handler.fn",
        )
        ir = _make_ir("h", [fn, call])
        out = cross_file_link.link({"/h.py": ir})
        edges = _via_local_edges(out["/h.py"]["edges"])
        self.assertEqual(len(edges), 0)


class TestLocalClassInstance(unittest.TestCase):
    """``cls_instance = LocalClass(...); cls_instance.method()`` — the
    receiver's binding resolves to a same-file class_def, not an
    external symbol. Edge target is the assignment; qualifiedTarget
    points at the class's method via the file's modulePath."""

    def test_local_class_instance_method_resolves_via_local(self):
        cls = _class("module/Widget.class", "Widget")
        fn = _fn("module/use.fn", "use")
        # parse_cst would emit a same-file reference edge from the
        # assignment to the class_def via its _defs table. Replicate.
        cls_instance_assign = _assign(
            "module/use.fn/cls_instance.assign", "cls_instance",
            "Widget", parent_id="module/use.fn",
        )
        method_call = _call(
            "module/use.fn/call@0", "cls_instance.method",
            parent_id="module/use.fn",
        )
        existing_ref_edge = {
            "source": "module/use.fn/cls_instance.assign",
            "target": "module/Widget.class",
            "type": "reference",
        }
        ir = _make_ir(
            "u",
            [cls, fn, cls_instance_assign, method_call],
            edges=[existing_ref_edge],
        )
        out = cross_file_link.link({"/u.py": ir})
        edges = _via_local_edges(out["/u.py"]["edges"])
        self.assertEqual(len(edges), 1, edges)
        e = edges[0]
        self.assertEqual(e["target"], "module/use.fn/cls_instance.assign")
        self.assertEqual(e["qualifiedTarget"], "u:Widget.method")
        self.assertEqual(e["viaLocal"], "cls_instance")


class TestSelfAssignmentDoesNotLoop(unittest.TestCase):
    """An assignment must not resolve through its own LHS binding —
    pre-execution the binding doesn't exist yet, and a self-loop edge
    would corrupt the IR. The skip happens inside emit_cross_file_edges."""

    def test_assignment_does_not_resolve_through_its_own_lhs(self):
        # x = foo(); x = x.bar()  — the second line's `x.bar` must not
        # produce an edge to its own assignment id.
        fn = _fn("module/loop.fn", "loop")
        x_first = _assign(
            "module/loop.fn/x.assign", "x",
            "argparse.ArgumentParser", parent_id="module/loop.fn",
        )
        # The parser doesn't dedupe assignment ids by re-using a name;
        # in practice the second assignment gets a fresh id. We model
        # both because the binding map is keyed by variable name, and
        # the second assignment shadows the first.
        x_second = _assign(
            "module/loop.fn/x.assign@1", "x",
            "x.add_subparsers", parent_id="module/loop.fn",
        )
        imp = _import("module/argparse.import", "argparse")
        ir = _make_ir("L", [imp, fn, x_first, x_second])
        out = cross_file_link.link({"/L.py": ir})
        edges = _via_local_edges(out["/L.py"]["edges"])
        # Whatever edge is emitted, source ≠ target. (In current
        # behaviour: the second assignment's lookup excludes its own
        # LHS binding, so it falls back to the first `x` binding and
        # emits an edge pointing at the first assignment.)
        for e in edges:
            self.assertNotEqual(
                e["source"], e["target"],
                "via-local edge must not point at its own source",
            )


class TestModuleScopeBinding(unittest.TestCase):
    """A binding made at module scope (not inside a function) should
    still be visible to module-scope calls. Less common but valid."""

    def test_module_scope_local_binding(self):
        imp = _import("module/argparse.import", "argparse")
        parser_assign = _assign(
            "module/parser.assign", "parser",
            "argparse.ArgumentParser", parent_id=None,
        )
        # A module-level statement-call (rare but legal): parser.print_help()
        call = _call("module/call@0", "parser.print_help", parent_id=None)
        ir = _make_ir("m", [imp, parser_assign, call])
        out = cross_file_link.link({"/m.py": ir})
        edges = _via_local_edges(out["/m.py"]["edges"])
        self.assertEqual(len(edges), 1, edges)
        self.assertEqual(edges[0]["qualifiedTarget"], "argparse:ArgumentParser.print_help")
        self.assertEqual(edges[0]["viaLocal"], "parser")


class TestRegressionImportOnlyResolution(unittest.TestCase):
    """Sanity-check that the M4a path still works untouched: a call
    resolvable through the import map alone (no local binding) still
    produces the v1.1 cross-file reference edge — no viaLocal field."""

    def test_cross_file_reference_edge_still_emitted(self):
        # File A defines `greet`; file B calls it via `from a import greet`.
        a_fn = _fn("module/greet.fn", "greet")
        a_ir = _make_ir("a", [a_fn])
        b_imp = _import_from("module/a.import_from", "a", "greet")
        b_fn = _fn("module/main.fn", "main")
        b_call = _call("module/main.fn/call@0", "greet", parent_id="module/main.fn")
        b_ir = _make_ir("b", [b_imp, b_fn, b_call])
        out = cross_file_link.link({"/a.py": a_ir, "/b.py": b_ir})
        b_edges = out["/b.py"]["edges"]
        cross_file_edges = [e for e in b_edges if e.get("targetFile") == "/a.py"]
        self.assertEqual(len(cross_file_edges), 1, cross_file_edges)
        e = cross_file_edges[0]
        self.assertNotIn("viaLocal", e)
        self.assertEqual(e["qualifiedTarget"], "a:greet")
        self.assertEqual(e["target"], "module/greet.fn")


class TestReturnTypeInference(unittest.TestCase):
    """§5.5 — one-hop return-type inference for lowercase-bound receivers.

    ``conn = _get_conn(); conn.execute(...)`` where
    ``def _get_conn() -> sqlite3.Connection:``. Pre-§5.5 the lowercase
    binding callee made the resolver refuse (M17.1's blanket skip), so
    ``conn.execute`` stayed honest ``dynamic``. §5.5 resolves one hop
    through the explicit return annotation to honest-external
    ``sqlite3:Connection.execute`` — but ONLY on an annotation contract,
    never a guess.
    """

    def _conn_module(self, returns):
        """A module: `import sqlite3`, a `_get_conn` helper with the given
        return annotation, and `conn = _get_conn(); conn.execute(q)`. The
        assignment→helper same-file reference edge mirrors what parse_cst
        emits via its _defs table."""
        imp = _import("module/sqlite3.import", "sqlite3")
        helper = _fn("module/_get_conn.fn", "_get_conn", returns=returns)
        fn = _fn("module/load.fn", "load")
        conn_assign = _assign(
            "module/load.fn/conn.assign", "conn",
            "_get_conn", parent_id="module/load.fn",
        )
        exec_call = _call(
            "module/load.fn/call@0", "conn.execute",
            parent_id="module/load.fn",
        )
        helper_ref = {
            "source": "module/load.fn/conn.assign",
            "target": "module/_get_conn.fn",
            "type": "reference",
        }
        return _make_ir(
            "db",
            [imp, helper, fn, conn_assign, exec_call],
            edges=[helper_ref],
        )

    def test_annotated_factory_resolves_method_via_return_type(self):
        ir = self._conn_module(returns="sqlite3.Connection")
        out = cross_file_link.link({"/db.py": ir})
        edges = _via_local_edges(out["/db.py"]["edges"])
        self.assertEqual(len(edges), 1, edges)
        e = edges[0]
        self.assertEqual(e["source"], "module/load.fn/call@0")
        self.assertEqual(e["target"], "module/load.fn/conn.assign")
        self.assertEqual(e["qualifiedTarget"], "sqlite3:Connection.execute")
        self.assertEqual(e["viaLocal"], "conn")
        self.assertNotIn("targetFile", e)

    def test_from_import_return_type_also_resolves(self):
        # `from sqlite3 import Connection` then `-> Connection`.
        imp = _import_from(
            "module/sqlite3.import_from", "sqlite3", "Connection",
        )
        helper = _fn("module/_get_conn.fn", "_get_conn", returns="Connection")
        fn = _fn("module/load.fn", "load")
        conn_assign = _assign(
            "module/load.fn/conn.assign", "conn",
            "_get_conn", parent_id="module/load.fn",
        )
        exec_call = _call(
            "module/load.fn/call@0", "conn.execute",
            parent_id="module/load.fn",
        )
        helper_ref = {
            "source": "module/load.fn/conn.assign",
            "target": "module/_get_conn.fn",
            "type": "reference",
        }
        ir = _make_ir(
            "db", [imp, helper, fn, conn_assign, exec_call],
            edges=[helper_ref],
        )
        out = cross_file_link.link({"/db.py": ir})
        edges = _via_local_edges(out["/db.py"]["edges"])
        self.assertEqual(len(edges), 1, edges)
        self.assertEqual(edges[0]["qualifiedTarget"], "sqlite3:Connection.execute")

    def test_unannotated_factory_emits_no_edge(self):
        # No return annotation → we never guess a type → no resolution,
        # the receiver stays honest `dynamic` downstream (no viaLocal edge).
        ir = self._conn_module(returns=None)
        out = cross_file_link.link({"/db.py": ir})
        self.assertEqual(len(_via_local_edges(out["/db.py"]["edges"])), 0)

    def test_builtin_return_type_emits_no_edge(self):
        # `-> dict` resolves to no importable qualified symbol (dict isn't
        # imported), so no misleading `dict.execute`-style edge is emitted.
        ir = self._conn_module(returns="dict")
        out = cross_file_link.link({"/db.py": ir})
        self.assertEqual(len(_via_local_edges(out["/db.py"]["edges"])), 0)


class TestCrossFileReturnTypeInference(unittest.TestCase):
    """§5.5 cross-file — the annotated factory lives in a DIFFERENT module
    from the caller. `db.py` defines `def get_conn() -> sqlite3.Connection:`;
    `app.py` does `from db import get_conn; conn = get_conn(); conn.execute()`.
    The project-wide return-type map resolves `conn.execute` to honest-external
    `sqlite3:Connection.execute` just like the same-file case."""

    def _project(self, db_returns):
        # db.py: import sqlite3; def get_conn() -> <db_returns>: ...
        db_imp = _import("module/sqlite3.import", "sqlite3")
        get_conn = _fn("module/get_conn.fn", "get_conn", returns=db_returns)
        db_ir = _make_ir("db", [db_imp, get_conn])
        # app.py: from db import get_conn; def load(): conn = get_conn(); conn.execute()
        app_imp = _import_from("module/db.import_from", "db", "get_conn")
        fn = _fn("module/load.fn", "load")
        conn_assign = _assign(
            "module/load.fn/conn.assign", "conn",
            "get_conn", parent_id="module/load.fn",
        )
        exec_call = _call(
            "module/load.fn/call@0", "conn.execute",
            parent_id="module/load.fn",
        )
        app_ir = _make_ir("app", [app_imp, fn, conn_assign, exec_call])
        return {"/db.py": db_ir, "/app.py": app_ir}

    def test_cross_file_annotated_factory_resolves_with_marker(self):
        out = cross_file_link.link(self._project("sqlite3.Connection"))
        edges = _via_local_edges(out["/app.py"]["edges"])
        self.assertEqual(len(edges), 1, edges)
        e = edges[0]
        self.assertEqual(e["source"], "module/load.fn/call@0")
        self.assertEqual(e["target"], "module/load.fn/conn.assign")
        self.assertEqual(e["qualifiedTarget"], "sqlite3:Connection.execute")
        self.assertEqual(e["viaLocal"], "conn")
        # §5.5 floor marker travels cross-file too.
        self.assertTrue(e.get("viaReturnType"))

    def test_cross_file_unannotated_factory_emits_no_edge(self):
        out = cross_file_link.link(self._project(None))
        self.assertEqual(len(_via_local_edges(out["/app.py"]["edges"])), 0)


if __name__ == "__main__":
    unittest.main()
