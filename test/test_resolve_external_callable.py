"""
Tests for scripts/resolve_external_callable.py — M13.1.

Covers the resolver's behaviour on:
  * stdlib happy path (sqlite3.connect → C-builtin with docstring)
  * stdlib introspectable path (os.path.join → real signature)
  * attribute-traversal happy path (json.JSONDecoder.decode)
  * third-party (requests.get — skipped if requests isn't installed)
  * class targets (Flask — surfaces __init__ signature)
  * unresolved: missing base module
  * unresolved: missing attribute on real base module
  * unresolved: empty / None input
  * the public dict shape (every key present + correctly typed)

Run with:
    PYTHONPATH=.pydeps:scripts python3 test/test_resolve_external_callable.py -v
"""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / ".pydeps"))

import resolve_external_callable as rxc  # noqa: E402


def _has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


# Keys every resolve() return must contain. The webview branches on
# these — missing any one is a regression worth catching here.
_REQUIRED_KEYS = {
    "qualifiedName",
    "kind",
    "signature",
    "signatureSource",
    "docstring",
    "module",
    "sourceFile",
    "isBuiltin",
    "error",
}


class TestResolveExternalCallable(unittest.TestCase):

    # ── public shape ───────────────────────────────────────────────

    def test_return_shape_has_all_required_keys(self):
        r = rxc.resolve("os.path.join")
        self.assertEqual(set(r.keys()), _REQUIRED_KEYS)

    def test_kind_is_always_one_of_three(self):
        for name in ("os.path.join", "nonexistent.thing", "", "sqlite3.connect"):
            r = rxc.resolve(name)
            self.assertIn(r["kind"], ("stdlib", "third_party", "unresolved"),
                          msg=f"unexpected kind for {name!r}: {r['kind']}")

    # ── stdlib happy paths ─────────────────────────────────────────

    def test_sqlite3_connect_returns_docstring_and_stub_signature(self):
        """C-extension callable: signature stub, real docstring."""
        r = rxc.resolve("sqlite3.connect")
        self.assertEqual(r["kind"], "stdlib")
        self.assertIsNone(r["error"])
        # sqlite3.connect is exposed by _sqlite3 (a C module) — its
        # signature isn't introspectable, but we synthesise "(...)"
        self.assertEqual(r["signature"], "(...)")
        self.assertEqual(r["signatureSource"], "stub")
        # The docstring is non-empty and mentions SQLite.
        self.assertIsNotNone(r["docstring"])
        self.assertIn("SQLite", r["docstring"])
        # Builtin status from inspect.isbuiltin.
        self.assertTrue(r["isBuiltin"])

    def test_os_path_join_returns_real_signature(self):
        """Python-level callable: real inspect.signature() result."""
        r = rxc.resolve("os.path.join")
        self.assertEqual(r["kind"], "stdlib")
        self.assertEqual(r["signatureSource"], "inspect")
        # Signature is `(a, *p)` on all CPython versions we care about
        # (3.10+); just check the shape.
        self.assertIsNotNone(r["signature"])
        self.assertTrue(r["signature"].startswith("("))
        self.assertTrue(r["signature"].endswith(")"))
        # Docstring mentions pathname or join.
        self.assertIsNotNone(r["docstring"])
        self.assertTrue(any(word in r["docstring"].lower()
                            for word in ("pathname", "join", "path")))

    def test_attribute_traversal_works_for_class_method(self):
        """Walk through json → JSONDecoder → decode."""
        r = rxc.resolve("json.JSONDecoder.decode")
        self.assertEqual(r["kind"], "stdlib")
        self.assertIsNone(r["error"])
        # decode IS introspectable as a method.
        self.assertIsNotNone(r["signature"])
        self.assertIn("decode", r["qualifiedName"])

    def test_class_target_surfaces_init_signature(self):
        """Resolving a class itself returns its __init__ signature."""
        r = rxc.resolve("collections.OrderedDict")
        self.assertEqual(r["kind"], "stdlib")
        self.assertIsNone(r["error"])
        self.assertIsNotNone(r["signature"])

    # ── builtins fallback (M13.2) ──────────────────────────────────

    def test_bare_builtin_print_resolves_via_builtins(self):
        """Bare names like `print` come from the thread extractor's
        KNOWN_BUILTINS set; they should resolve as builtins.<name>."""
        r = rxc.resolve("print")
        self.assertEqual(r["kind"], "stdlib")
        self.assertEqual(r["module"], "builtins")
        self.assertIsNone(r["error"])
        # print has an introspectable signature in CPython 3.10+.
        self.assertIsNotNone(r["signature"])
        self.assertIn("Prints", r["docstring"] or "")

    def test_bare_builtin_len_resolves(self):
        r = rxc.resolve("len")
        self.assertEqual(r["kind"], "stdlib")
        self.assertEqual(r["module"], "builtins")
        self.assertTrue(r["isBuiltin"])

    def test_bare_module_name_still_resolves(self):
        """`os` (a bare name that IS a module, not a builtin function)
        should still resolve — fallback path in _import_base."""
        r = rxc.resolve("os")
        self.assertEqual(r["kind"], "stdlib")
        # Module's own __module__ is None; we surface base instead.
        self.assertIn(r["module"], (None, "os"))

    # ── third-party (conditional) ──────────────────────────────────

    @unittest.skipUnless(_has_module("requests"),
                         "requests not installed in the test interpreter")
    def test_requests_get_resolves_as_third_party(self):
        r = rxc.resolve("requests.get")
        self.assertEqual(r["kind"], "third_party")
        self.assertIsNone(r["error"])
        self.assertIsNotNone(r["docstring"])

    # ── unresolved paths ───────────────────────────────────────────

    def test_missing_base_module_returns_unresolved(self):
        r = rxc.resolve("definitely_not_a_module.thing")
        self.assertEqual(r["kind"], "unresolved")
        self.assertIsNotNone(r["error"])
        self.assertIn("not importable", r["error"])
        # `module` carries the attempted base so the webview can still
        # render "Imported from `definitely_not_a_module`".
        self.assertEqual(r["module"], "definitely_not_a_module")

    def test_missing_attribute_on_real_module_returns_unresolved(self):
        r = rxc.resolve("sqlite3.this_does_not_exist")
        self.assertEqual(r["kind"], "unresolved")
        self.assertIsNotNone(r["error"])
        self.assertIn("attribute walk failed", r["error"])
        self.assertEqual(r["module"], "sqlite3")

    def test_empty_input_returns_unresolved(self):
        r = rxc.resolve("")
        self.assertEqual(r["kind"], "unresolved")
        self.assertIsNotNone(r["error"])

    def test_non_string_input_returns_unresolved(self):
        # The script is called from the WS handler which JSON-parses
        # the payload; non-string can in principle slip through. The
        # resolver should never raise on it.
        r = rxc.resolve(None)  # type: ignore[arg-type]
        self.assertEqual(r["kind"], "unresolved")
        self.assertIsNotNone(r["error"])

    # ── never-raise invariant ──────────────────────────────────────

    def test_resolve_never_raises_for_any_string_input(self):
        """
        Property test (light): a handful of pathologically-shaped
        inputs all produce a dict (never raise).
        """
        for s in [
            "",
            ".",
            ". ",
            "foo.",
            ".foo",
            "...",
            "import sys",                  # not a name
            "sqlite3.connect()",            # has parens; AttributeError
            "🐍.connect",                    # non-ASCII module name
            "sys.__dict__",                 # weird but legal
        ]:
            r = rxc.resolve(s)
            self.assertIsInstance(r, dict, msg=f"resolve({s!r}) didn't return a dict")
            self.assertIn("kind", r)


if __name__ == "__main__":
    unittest.main()
