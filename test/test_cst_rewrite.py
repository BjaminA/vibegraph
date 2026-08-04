"""
Tests for scripts/cst_rewrite.py — the CST-backed structured rewriter.

Covers:
    * replace_node (no-op round-trip is byte-identical)
    * insert_before / insert_after
    * delete_node (preserves leading blank lines)
    * append_end
    * rename_in_scope (+ shadowed-name handling)
    * comment toggle via replace_node
    * type-annotation add via replace_node

Run with:
    PYTHONPATH=.pydeps python3 -m unittest test.test_cst_rewrite -v
"""

import contextlib
import sys
import textwrap
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / ".pydeps"))

import cst_rewrite  # noqa: E402
import libcst as cst  # noqa: E402 — used by the M12.1 add-component tests


# M-DIRTY — genuine out-of-span corruption, for the confinement guard.
#
# Originally these tests injected an out-of-span change by handing the op a
# non-black-clean file and letting WHOLE-FILE black reflow a distant line.
# That is exactly the false rejection M-DIRTY removes, so it stopped being
# an injection mechanism. Corrupting the FORMATTER is no longer one either:
# the pipeline's last candidate skips black entirely, so a broken formatter
# is now recovered from rather than written (see
# test_corrupting_formatter_is_recovered_not_written) — which is correct,
# the corruption never reaches disk.
#
# What the guard actually exists to catch is the REWRITER damaging content
# outside the target. Corrupting every candidate models that faithfully,
# for both the generic pipeline and the self-pipelining ops, and is
# independent of black's behaviour.
@contextlib.contextmanager
def _pipeline_that_corrupts(marker, replacement):
    real = cst_rewrite._format_candidates

    def fake(out, ranges, do_format):
        for candidate in real(out, ranges, do_format):
            yield candidate.replace(marker, replacement)

    with mock.patch.object(cst_rewrite, "_format_candidates", fake):
        yield


@contextlib.contextmanager
def _formatter_that_corrupts(marker, replacement):
    real = cst_rewrite._run_black

    def fake(source, line_ranges=None):
        return real(source, line_ranges).replace(marker, replacement)

    with mock.patch.object(cst_rewrite, "_run_black", fake):
        yield


SAMPLE = textwrap.dedent(
    '''\
    import math


    PI = 3.14159
    x = 10


    def calculate_area(radius):
        """Calculate the area of a circle."""
        return PI * radius ** 2


    def greet(name):
        return f"hello, {name}!"


    class Shape:
        kind = "generic"

        def describe(self):
            return self.kind


    result = calculate_area(10)
    print(result)
    '''
)


SHADOW = textwrap.dedent(
    """\
    x = 1


    def foo():
        x = 100  # local x shadows module x
        return x


    def bar():
        return x  # free reference resolves to module x


    print(x)
    """
)


# ── helpers ────────────────────────────────────────────────────────────

def _apply(op, source, **kwargs):
    """Run apply() with format and diff-check OFF for predictable byte-level checks."""
    return cst_rewrite.apply(
        source=source,
        op=op,
        target_id=kwargs.get("target_id"),
        new_source=kwargs.get("new_source"),
        new_name=kwargs.get("new_name"),
        do_format=False,
        do_diff_check=False,
        default_value=kwargs.get("default_value"),
        type_annotation=kwargs.get("type_annotation"),
        position=kwargs.get("position"),
    )


# ── replace_node ───────────────────────────────────────────────────────

class TestReplaceNode(unittest.TestCase):

    def test_noop_round_trip_is_byte_identical(self):
        """The Stage-2 invariant: replacing a node with its own source is a no-op."""
        new_src = textwrap.dedent('''\
            def calculate_area(radius):
                """Calculate the area of a circle."""
                return PI * radius ** 2
            ''')
        out = _apply("replace_node", SAMPLE,
                     target_id="module/calculate_area.fn",
                     new_source=new_src)
        self.assertEqual(out, SAMPLE)

    def test_replace_changes_function_body(self):
        new_src = "def calculate_area(radius):\n    return 3.14 * radius * radius\n"
        out = _apply("replace_node", SAMPLE,
                     target_id="module/calculate_area.fn",
                     new_source=new_src)
        self.assertIn("3.14 * radius * radius", out)
        self.assertNotIn('"""Calculate the area of a circle."""', out)
        # Surrounding code unchanged
        self.assertIn("PI = 3.14159", out)
        self.assertIn("def greet(name):", out)

    def test_replace_unknown_id_raises(self):
        with self.assertRaises(KeyError):
            _apply("replace_node", SAMPLE,
                   target_id="module/does_not_exist.fn",
                   new_source="x = 1\n")

    def test_replace_with_invalid_python_raises(self):
        from libcst._exceptions import ParserSyntaxError
        with self.assertRaises(ParserSyntaxError):
            _apply("replace_node", SAMPLE,
                   target_id="module/PI.assign",
                   new_source="def broken syntax(((")


# ── insert_before / insert_after ───────────────────────────────────────

class TestInsert(unittest.TestCase):

    def test_insert_before_adds_helper(self):
        out = _apply("insert_before", SAMPLE,
                     target_id="module/calculate_area.fn",
                     new_source="def helper():\n    return 42\n")
        # helper appears, calculate_area still appears, helper is BEFORE
        self.assertIn("def helper():", out)
        self.assertIn("def calculate_area(radius):", out)
        self.assertLess(out.index("def helper"), out.index("def calculate_area"))

    def test_insert_after_adds_after(self):
        out = _apply("insert_after", SAMPLE,
                     target_id="module/calculate_area.fn",
                     new_source="def double_area(r):\n    return calculate_area(r) * 2\n")
        self.assertIn("def double_area", out)
        self.assertGreater(out.index("def double_area"), out.index("def calculate_area"))
        # Surrounding context preserved
        self.assertIn("def greet(name):", out)


# ── delete_node ────────────────────────────────────────────────────────

class TestDelete(unittest.TestCase):

    def test_delete_assignment_preserves_neighbouring_blank(self):
        """When deleting a stmt with leading blank lines, the blank line is
        forwarded to the next sibling — file is exactly 1 line shorter, not 2."""
        before_lines = SAMPLE.splitlines()
        out = _apply("delete_node", SAMPLE, target_id="module/result.assign")
        after_lines = out.splitlines()
        self.assertEqual(len(before_lines) - len(after_lines), 1,
                         msg=f"expected 1 line removed, got {len(before_lines) - len(after_lines)}")
        self.assertNotIn("result = calculate_area(10)", out)
        self.assertIn("print(result)", out)  # next sibling still there

    def test_delete_function(self):
        out = _apply("delete_node", SAMPLE, target_id="module/greet.fn")
        self.assertNotIn("def greet(name):", out)
        # neighbours preserved
        self.assertIn("def calculate_area(radius):", out)
        self.assertIn("class Shape:", out)


# ── append_end ─────────────────────────────────────────────────────────

class TestAppendEnd(unittest.TestCase):

    def test_append_end_adds_at_module_tail(self):
        out = _apply("append_end", SAMPLE, new_source="\nresult2 = calculate_area(20)\n")
        self.assertTrue(out.startswith(SAMPLE.rstrip() + "\n") or SAMPLE.rstrip() in out)
        self.assertIn("result2 = calculate_area(20)", out)
        # original tail still present
        self.assertIn("print(result)", out)


# ── rename_in_scope ────────────────────────────────────────────────────

class TestRenameInScope(unittest.TestCase):

    def test_rename_module_assignment_renames_both_def_and_use(self):
        out = _apply("rename_in_scope", SAMPLE,
                     target_id="module/PI.assign", new_name="CIRCLE_PI")
        self.assertIn("CIRCLE_PI = 3.14159", out)
        # use inside calculate_area should be renamed too
        self.assertIn("CIRCLE_PI * radius ** 2", out)
        self.assertNotIn(" PI ", out)
        # unrelated names untouched
        self.assertIn("calculate_area", out)
        self.assertIn("greet(name)", out)

    def test_rename_function_renames_calls_too(self):
        out = _apply("rename_in_scope", SAMPLE,
                     target_id="module/calculate_area.fn", new_name="compute_area")
        self.assertIn("def compute_area(radius):", out)
        self.assertIn("result = compute_area(10)", out)
        self.assertNotIn("calculate_area", out)

    def test_rename_skips_shadowed_inner_scopes(self):
        """foo's local `x` is unrelated to module-level `x` — must NOT rename."""
        out = _apply("rename_in_scope", SHADOW,
                     target_id="module/x.assign", new_name="Y")
        # Module-level x renamed
        self.assertIn("Y = 1", out)
        # foo's inner x is the local one — left alone (assignment + return both)
        self.assertIn("x = 100  # local x shadows module x", out)
        self.assertIn("    return x\n", out)  # foo's `return x` (with module x scope)
        # bar's free reference resolves to module — renamed
        self.assertIn("return Y  # free reference resolves to module x", out)
        # print(x) at module scope — renamed
        self.assertIn("print(Y)", out)

    def test_rename_invalid_identifier_raises(self):
        with self.assertRaises(ValueError):
            _apply("rename_in_scope", SAMPLE,
                   target_id="module/PI.assign", new_name="123-bad")


# ── comment toggle / type annotation add (use cases of replace_node) ──

class TestEditUseCases(unittest.TestCase):

    def test_comment_toggle_via_replace(self):
        """Add a leading comment to a function — comment is part of leading_lines."""
        new_src = (
            "# TODO: validate radius is non-negative\n"
            "def calculate_area(radius):\n"
            '    """Calculate the area of a circle."""\n'
            "    return PI * radius ** 2\n"
        )
        out = _apply("replace_node", SAMPLE,
                     target_id="module/calculate_area.fn",
                     new_source=new_src)
        self.assertIn("# TODO: validate radius is non-negative", out)
        self.assertIn("def calculate_area(radius):", out)
        # surrounding context unchanged
        self.assertIn("PI = 3.14159", out)
        self.assertIn("def greet(name):", out)

    def test_type_annotation_add_via_replace(self):
        """Replace a function def with a typed-parameter version."""
        new_src = (
            "def calculate_area(radius: float) -> float:\n"
            '    """Calculate the area of a circle."""\n'
            "    return PI * radius ** 2\n"
        )
        out = _apply("replace_node", SAMPLE,
                     target_id="module/calculate_area.fn",
                     new_source=new_src)
        self.assertIn("def calculate_area(radius: float) -> float:", out)
        self.assertNotIn("def calculate_area(radius):", out)


# ── format-and-diff verification ───────────────────────────────────────

class TestFormatAndDiff(unittest.TestCase):

    def test_format_normalises_spacing(self):
        """black turns `radius ** 2` → `radius**2`. Diff-check disabled here
        because black may also normalise blank-line counts outside the
        targeted span if the original SAMPLE wasn't strictly black-clean —
        that's a separate concern from format-correctness."""
        new_src = (
            "def calculate_area(radius):\n"
            '    """Calculate the area of a circle."""\n'
            "    return PI * radius ** 2\n"
        )
        out = cst_rewrite.apply(
            source=SAMPLE, op="replace_node",
            target_id="module/calculate_area.fn",
            new_source=new_src, new_name=None,
            do_format=True, do_diff_check=False,
        )
        # black collapses `radius ** 2` to `radius**2`
        self.assertIn("radius**2", out)

    def test_diff_check_rejects_when_pre_lines_change(self):
        """If anything corrupts lines outside the target span, the check
        rejects the result — the M2 invariant."""
        src = "x = 1\nPI = 3.14\ny = 2\n"
        with _pipeline_that_corrupts("PI = 3.14", "PI = 9.99"):
            with self.assertRaises(RuntimeError):
                cst_rewrite.apply(
                    source=src, op="replace_node",
                    target_id="module/x.assign",
                    new_source="x = 1\n",
                    new_name=None,
                    do_format=True, do_diff_check=True,
                )

    def test_verify_diff_confined_rejects_out_of_span_edit(self):
        """The guard itself, independent of any op or formatter: a single
        changed line outside the target span is refused."""
        pre = "x = 1\nPI = 3.14\ny = 2\n"
        post = "x = 1\nPI = 9.99\ny = 2\n"
        with self.assertRaises(RuntimeError):
            # target span = line 1 only; the change on line 2 escapes it
            cst_rewrite._verify_diff_confined(pre, post, (1, 1), "replace_node")

    def test_verify_diff_confined_accepts_in_span_edit(self):
        pre = "x = 1\nPI = 3.14\ny = 2\n"
        post = "x = 2\nPI = 3.14\ny = 2\n"
        cst_rewrite._verify_diff_confined(pre, post, (1, 1), "replace_node")


# ── M12.1 add-component ops ────────────────────────────────────────────
#
# PLAN-v3.md §5.2: four additive ops shipped behind a structured
# errorKind contract (§5.3). Per the M12.1 Done clause, each op gets
# ≥3 tests: happy-path, validation-error (with errorKind assertion),
# diff-confinement-under-black. Plus errorKind-coverage tests that
# exercise the rest of the taxonomy (target_not_found / wrong_node_kind
# / invalid_identifier).

# A fixture with body-bearing nodes and a statement-level call to drop
# on, mirroring the kind of shape M12.2's UI will produce drops on.
ADDFIX = textwrap.dedent(
    '''\
    """Module for M12.1 add-component op tests."""

    import math


    def small(radius):
        return radius


    def get_area(radius):
        return math.pi * radius * radius


    class Shape:
        kind = "generic"

        def describe(self):
            return self.kind


    for i in range(3):
        print(i)


    n = 0
    while n < 3:
        n = n + 1


    if n > 0:
        print(n)


    print("done")
    '''
)


def _err_kind(exc):
    """Return the errorKind attribute if the exception is an OpError; None otherwise."""
    return getattr(exc, "kind", None)


# ── op_insert_as_first_child ──────────────────────────────────────────

class TestInsertAsFirstChild(unittest.TestCase):

    def test_happy_path_into_function_body(self):
        out = _apply("insert_as_first_child", ADDFIX,
                     target_id="module/get_area.fn",
                     new_source="r = radius + 0\n")
        # New stmt appears inside get_area; appears BEFORE the existing return
        idx_def = out.index("def get_area(radius):")
        idx_new = out.index("r = radius + 0", idx_def)
        idx_ret = out.index("return math.pi", idx_def)
        self.assertLess(idx_def, idx_new)
        self.assertLess(idx_new, idx_ret)
        # Outside-the-function context preserved
        self.assertIn("def small(radius):", out)
        self.assertIn("class Shape:", out)

    def test_happy_path_into_for_loop_body(self):
        # Use the structural ID grammar: for-loops are named by their iterator
        # expression. Resolve programmatically rather than hard-coding.
        # parse_cst names: `module/for@<line>` style; build the ID by parsing.
        ids = _ids_in(ADDFIX)
        for_ids = [k for k in ids if "for" in k.lower() and ".for" in k or "/for@" in k]
        # Fall back: take any id whose node type is For by re-resolving.
        target_id = _first_id_of_type(ADDFIX, cst.For)
        out = _apply("insert_as_first_child", ADDFIX,
                     target_id=target_id,
                     new_source="x = i * 2\n")
        # New stmt is inside the for body, before print(i)
        idx_for = out.index("for i in range(3):")
        idx_new = out.index("x = i * 2", idx_for)
        idx_print = out.index("print(i)", idx_for)
        self.assertLess(idx_new, idx_print)

    def test_happy_path_into_class_body(self):
        out = _apply("insert_as_first_child", ADDFIX,
                     target_id="module/Shape.class",
                     new_source="version = 1\n")
        idx_cls = out.index("class Shape:")
        idx_new = out.index("version = 1", idx_cls)
        idx_kind = out.index('kind = "generic"', idx_cls)
        self.assertLess(idx_new, idx_kind)

    def test_validation_error_invalid_python_emits_parse_error(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("insert_as_first_child", ADDFIX,
                   target_id="module/get_area.fn",
                   new_source="def broken (((")
        self.assertEqual(_err_kind(ctx.exception), "parse_error")

    def test_wrong_node_kind_when_target_is_not_body_bearing(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("insert_as_first_child", ADDFIX,
                   target_id="module/n.assign",
                   new_source="x = 1\n")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_target_not_found_emits_target_not_found(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("insert_as_first_child", ADDFIX,
                   target_id="module/does_not_exist.fn",
                   new_source="x = 1\n")
        self.assertEqual(_err_kind(ctx.exception), "target_not_found")

    def test_diff_confinement_under_black(self):
        """black turns the inserted stmt's indent canonical; the rest of the
        file must remain byte-equivalent (per format-and-diff verification)."""
        out = cst_rewrite.apply(
            source=ADDFIX, op="insert_as_first_child",
            target_id="module/get_area.fn",
            new_source="r = radius * 1\n",
            new_name=None,
            do_format=True, do_diff_check=True,
        )
        self.assertIn("r = radius * 1", out)


# ── op_insert_as_last_child ───────────────────────────────────────────

class TestInsertAsLastChild(unittest.TestCase):

    def test_happy_path_into_function_body(self):
        out = _apply("insert_as_last_child", ADDFIX,
                     target_id="module/small.fn",
                     new_source="print(radius)\n")
        idx_def = out.index("def small(radius):")
        idx_ret = out.index("return radius", idx_def)
        idx_new = out.index("print(radius)", idx_def)
        # New stmt appears INSIDE small, AFTER the return
        self.assertGreater(idx_new, idx_ret)
        # …but BEFORE the next sibling (get_area)
        idx_next = out.index("def get_area(radius):")
        self.assertLess(idx_new, idx_next)

    def test_happy_path_into_for_loop_body(self):
        # parse_cst.py doesn't emit while_loop IR nodes today (no
        # visit_While in GraphBuilder), so while-as-target isn't
        # exercisable through the IR-id path. The rewriter itself
        # supports cst.While; this test covers for-loop body insertion
        # instead. See M12.1 commit message + PLAN-v3 §2 follow-up note.
        target_id = _first_id_of_type(ADDFIX, cst.For)
        out = _apply("insert_as_last_child", ADDFIX,
                     target_id=target_id,
                     new_source="print('after')\n")
        idx_for = out.index("for i in range(3):")
        idx_new = out.index("print('after')", idx_for)
        idx_orig = out.index("print(i)", idx_for)
        # New stmt appears AFTER the existing print(i), inside the loop body
        self.assertGreater(idx_new, idx_orig)

    def test_happy_path_into_if_body(self):
        target_id = _first_id_of_type(ADDFIX, cst.If)
        out = _apply("insert_as_last_child", ADDFIX,
                     target_id=target_id,
                     new_source="print('n is positive')\n")
        idx_if = out.index("if n > 0:")
        idx_new = out.index("print('n is positive')", idx_if)
        self.assertGreater(idx_new, idx_if)

    def test_validation_error_invalid_python_emits_parse_error(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("insert_as_last_child", ADDFIX,
                   target_id="module/small.fn",
                   new_source="for in ::")
        self.assertEqual(_err_kind(ctx.exception), "parse_error")

    def test_wrong_node_kind_on_assignment_target(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("insert_as_last_child", ADDFIX,
                   target_id="module/n.assign",
                   new_source="x = 1\n")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_diff_confinement_under_black(self):
        out = cst_rewrite.apply(
            source=ADDFIX, op="insert_as_last_child",
            target_id="module/small.fn",
            new_source="pass\n",
            new_name=None,
            do_format=True, do_diff_check=True,
        )
        # pass appears inside small's body
        idx_def = out.index("def small(radius):")
        idx_pass = out.index("pass", idx_def)
        idx_next = out.index("def get_area")
        self.assertLess(idx_pass, idx_next)


# ── op_append_positional_arg ───────────────────────────────────────────

class TestAppendPositionalArg(unittest.TestCase):

    def test_happy_path_appends_arg(self):
        # IR captures call nodes by their wrapping Expr (parse_cst.visit_Expr
        # at scripts/parse_cst.py:378), not the bare cst.Call — so a
        # `_first_id_of_type(cst.Call)` lookup would miss. Resolve by
        # function name instead, which is what M12.2's UI will do.
        target_id = _first_call_with_name(ADDFIX, "print")
        out = _apply("append_positional_arg", ADDFIX,
                     target_id=target_id,
                     new_source="i * 10")
        # print(i, i * 10)
        self.assertRegex(out, r"print\(i,\s*i \* 10\)")

    def test_happy_path_on_call_with_no_existing_args(self):
        # Add a fixture-local call with no args. Use the describe() body — no
        # zero-arg call exists in ADDFIX, so synthesise one and verify the op
        # adds the first positional arg correctly.
        src = textwrap.dedent('''\
            def go():
                pass


            go()
            ''')
        # The `go()` call at module scope is wrapped in SimpleStatementLine→Expr→Call.
        call_id = _first_call_with_name(src, "go")
        out = _apply("append_positional_arg", src,
                     target_id=call_id,
                     new_source="42")
        self.assertIn("go(42)", out)

    def test_validation_error_invalid_expression_emits_parse_error(self):
        target_id = _first_call_with_name(ADDFIX, "print")
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("append_positional_arg", ADDFIX,
                   target_id=target_id,
                   new_source="if x:")
        self.assertEqual(_err_kind(ctx.exception), "parse_error")

    def test_wrong_node_kind_on_non_call_target(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("append_positional_arg", ADDFIX,
                   target_id="module/get_area.fn",
                   new_source="42")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_target_not_found_emits_target_not_found(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("append_positional_arg", ADDFIX,
                   target_id="module/does_not_exist.call",
                   new_source="1")
        self.assertEqual(_err_kind(ctx.exception), "target_not_found")

    def test_diff_confinement_under_black(self):
        target_id = _first_call_with_name(ADDFIX, "print")
        out = cst_rewrite.apply(
            source=ADDFIX, op="append_positional_arg",
            target_id=target_id, new_source="2",
            new_name=None, do_format=True, do_diff_check=True,
        )
        self.assertRegex(out, r"print\(i,\s*2\)")


# ── op_append_keyword_arg ──────────────────────────────────────────────

class TestAppendKeywordArg(unittest.TestCase):

    def test_happy_path_appends_keyword(self):
        target_id = _first_call_with_name(ADDFIX, "print")
        out = _apply("append_keyword_arg", ADDFIX,
                     target_id=target_id,
                     new_name="end",
                     new_source='""')
        # print(i, end="")  — note: no space around `=` per the equal whitespace nodes
        self.assertRegex(out, r'print\(i,\s*end=""\)')

    def test_validation_error_invalid_expression_emits_parse_error(self):
        target_id = _first_call_with_name(ADDFIX, "print")
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("append_keyword_arg", ADDFIX,
                   target_id=target_id,
                   new_name="end",
                   new_source="def broken")
        self.assertEqual(_err_kind(ctx.exception), "parse_error")

    def test_invalid_identifier_emits_invalid_identifier(self):
        target_id = _first_call_with_name(ADDFIX, "print")
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("append_keyword_arg", ADDFIX,
                   target_id=target_id,
                   new_name="123-bad",
                   new_source='"x"')
        self.assertEqual(_err_kind(ctx.exception), "invalid_identifier")

    def test_invalid_identifier_with_unicode_emits_invalid_identifier(self):
        target_id = _first_call_with_name(ADDFIX, "print")
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("append_keyword_arg", ADDFIX,
                   target_id=target_id,
                   new_name="key with spaces",
                   new_source='"x"')
        self.assertEqual(_err_kind(ctx.exception), "invalid_identifier")

    def test_wrong_node_kind_on_non_call_target(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("append_keyword_arg", ADDFIX,
                   target_id="module/Shape.class",
                   new_name="x",
                   new_source="1")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_diff_confinement_under_black(self):
        target_id = _first_call_with_name(ADDFIX, "print")
        out = cst_rewrite.apply(
            source=ADDFIX, op="append_keyword_arg",
            target_id=target_id, new_source='""',
            new_name="end", do_format=True, do_diff_check=True,
        )
        self.assertRegex(out, r'print\(i,\s*end=""\)')


# ── errorKind taxonomy coverage ────────────────────────────────────────
#
# PLAN-v3.md §5.3 lists five kinds; the per-op tests above hit four
# (parse_error / wrong_node_kind / invalid_identifier / target_not_found).
# diff_confinement_failed is exercised here against a deliberately
# pre-edit-ugly fixture so black formats lines outside the target span.

class TestErrorKindTaxonomyCoverage(unittest.TestCase):

    def test_diff_confinement_failed_emits_correct_kind(self):
        # An M12 op, so the orchestrator translates RuntimeError → OpError.
        # PI lives outside the insert_as_last_child target span.
        src = textwrap.dedent("""\
            x = 1
            PI = 3.14


            def f():
                return x
            """)
        with _pipeline_that_corrupts("PI = 3.14", "PI = 9.99"):
            with self.assertRaises(cst_rewrite.OpError) as ctx:
                cst_rewrite.apply(
                    source=src, op="insert_as_last_child",
                    target_id="module/f.fn",
                    new_source="pass\n",
                    new_name=None,
                    do_format=True, do_diff_check=True,
                )
        self.assertEqual(_err_kind(ctx.exception), "diff_confinement_failed")

    def test_op_error_is_a_runtime_error(self):
        """Existing tests that use assertRaises(RuntimeError) on
        diff-confinement must still catch OpError. Verifies the
        inheritance contract."""
        self.assertTrue(issubclass(cst_rewrite.OpError, RuntimeError))

    def test_op_error_rejects_invalid_kind(self):
        with self.assertRaises(ValueError):
            cst_rewrite.OpError("not_a_real_kind", "test")

    def test_all_five_kinds_are_reachable(self):
        """Smoke-check: each of the five §5.3 kinds is produced by one of
        the new ops under some failure path covered above."""
        kinds_seen = set()
        # parse_error
        try:
            _apply("insert_as_first_child", ADDFIX,
                   target_id="module/get_area.fn",
                   new_source="((((")
        except cst_rewrite.OpError as e:
            kinds_seen.add(e.kind)
        # wrong_node_kind
        try:
            _apply("append_positional_arg", ADDFIX,
                   target_id="module/get_area.fn",
                   new_source="1")
        except cst_rewrite.OpError as e:
            kinds_seen.add(e.kind)
        # invalid_identifier
        try:
            _apply("append_keyword_arg", ADDFIX,
                   target_id=_first_call_with_name(ADDFIX, "print"),
                   new_name="1bad",
                   new_source='"x"')
        except cst_rewrite.OpError as e:
            kinds_seen.add(e.kind)
        # target_not_found
        try:
            _apply("insert_as_last_child", ADDFIX,
                   target_id="module/missing.fn",
                   new_source="pass\n")
        except cst_rewrite.OpError as e:
            kinds_seen.add(e.kind)
        # diff_confinement_failed — covered by separate test above; assert
        # the four reachable from this method are present.
        self.assertEqual(kinds_seen, {
            "parse_error", "wrong_node_kind",
            "invalid_identifier", "target_not_found",
        })


# ── id-helpers used by the M12.1 tests ─────────────────────────────────

def _ids_in(source):
    """Return the id-set the rewriter would see for this source."""
    import libcst as cst
    sys.path.insert(0, str(ROOT / "scripts"))
    from parse_cst import GraphBuilder
    import libcst.metadata as meta
    module = cst.parse_module(source)
    wrapper = meta.MetadataWrapper(module)
    builder = GraphBuilder(wrapper.module, capture_nodes=True)
    wrapper.visit(builder)
    return set(builder.nodes_by_id.keys())


def _first_id_of_type(source, type_):
    """Return the first id whose node is an instance of `type_`."""
    import libcst as cst
    sys.path.insert(0, str(ROOT / "scripts"))
    from parse_cst import GraphBuilder
    import libcst.metadata as meta
    module = cst.parse_module(source)
    wrapper = meta.MetadataWrapper(module)
    builder = GraphBuilder(wrapper.module, capture_nodes=True)
    wrapper.visit(builder)
    for node_id, node in builder.nodes_by_id.items():
        if isinstance(node, type_):
            return node_id
    raise AssertionError(f"no node of type {type_.__name__} found")


def _first_call_with_name(source, name):
    """
    Return the first id whose node is a Call (possibly wrapped in
    SimpleStatementLine/Expr) with the given function name.

    Falls back to inspecting the node and matching `funcName` heuristically.
    """
    import libcst as cst
    sys.path.insert(0, str(ROOT / "scripts"))
    from parse_cst import GraphBuilder
    import libcst.metadata as meta
    module = cst.parse_module(source)
    wrapper = meta.MetadataWrapper(module)
    builder = GraphBuilder(wrapper.module, capture_nodes=True)
    wrapper.visit(builder)
    for node_id, node in builder.nodes_by_id.items():
        call = cst_rewrite._find_call_in_target(node)
        if call is None:
            continue
        func = call.func
        # Match either a bare Name(name) or an Attribute whose attr matches
        if isinstance(func, cst.Name) and func.value == name:
            return node_id
        if isinstance(func, cst.Attribute) and func.attr.value == name:
            return node_id
    raise AssertionError(f"no Call with funcName == {name!r} found")


# ── M16.1: op_add_function_parameter ──────────────────────────────────
#
# PLAN-v4.md §4.4 / §4.6 M16.1: signature-edit op driving the
# "Add to enclosing function" affordance in the M16.4 ArgumentEditorPanel.
# Coverage targets (per PLAN-v4 §4.6): append-to-empty, append-to-populated,
# insert-before-named, parse_error on bad default, wrong_node_kind on
# non-function target, invalid_identifier on bad name, diff-confinement
# under black.

# Fixture mirrors typical "enclosing-function-needs-a-new-param" shapes —
# empty signature, populated signature, defaults, *args/**kwargs, methods
# with self. The IR ids resolve via `module/<fn>.fn` for module-scope
# defs and `module/<Cls>.class/<fn>.fn` for methods.
PARAMFIX = textwrap.dedent(
    '''\
    """Module for M16.1 add_function_parameter tests."""


    def no_params():
        return 1


    def two_params(a, b):
        return a + b


    def with_defaults(x, y=5):
        return x * y


    def with_kwargs(*args, **kwargs):
        return len(args)


    class Worker:
        def run(self, payload):
            return payload
    '''
)


class TestAddFunctionParameter(unittest.TestCase):

    def test_append_to_empty_signature(self):
        out = _apply("add_function_parameter", PARAMFIX,
                     target_id="module/no_params.fn",
                     new_name="x")
        self.assertIn("def no_params(x):", out)
        # Other functions untouched
        self.assertIn("def two_params(a, b):", out)
        self.assertIn("def with_defaults(x, y=5):", out)

    def test_append_to_populated_signature(self):
        out = _apply("add_function_parameter", PARAMFIX,
                     target_id="module/two_params.fn",
                     new_name="c")
        self.assertIn("def two_params(a, b, c):", out)
        # body preserved
        self.assertIn("return a + b", out)

    def test_insert_before_named_param(self):
        out = _apply("add_function_parameter", PARAMFIX,
                     target_id="module/two_params.fn",
                     new_name="z",
                     position="before:b")
        self.assertIn("def two_params(a, z, b):", out)

    def test_append_with_default_value(self):
        out = _apply("add_function_parameter", PARAMFIX,
                     target_id="module/two_params.fn",
                     new_name="c",
                     default_value="42")
        # libcst emits `c=42` or `c = 42` depending on Param defaults; either
        # is fine for the no-format path. Match a tolerant pattern.
        self.assertRegex(out, r"def two_params\(a, b, c\s*=\s*42\):")

    def test_append_with_type_annotation(self):
        out = _apply("add_function_parameter", PARAMFIX,
                     target_id="module/two_params.fn",
                     new_name="c",
                     type_annotation="int")
        self.assertIn("def two_params(a, b, c: int):", out)

    def test_append_to_method_with_self(self):
        # Methods are reachable via the class-nested id. The op should
        # leave `self` as the first param and append after the existing
        # ones.
        out = _apply("add_function_parameter", PARAMFIX,
                     target_id="module/Worker.class/run.fn",
                     new_name="timeout")
        self.assertIn("def run(self, payload, timeout):", out)

    def test_parse_error_on_bad_default(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("add_function_parameter", PARAMFIX,
                   target_id="module/two_params.fn",
                   new_name="c",
                   default_value="if x:")
        self.assertEqual(_err_kind(ctx.exception), "parse_error")

    def test_parse_error_on_bad_annotation(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("add_function_parameter", PARAMFIX,
                   target_id="module/two_params.fn",
                   new_name="c",
                   type_annotation="def f(:")
        self.assertEqual(_err_kind(ctx.exception), "parse_error")

    def test_wrong_node_kind_on_non_function_target(self):
        # Class target — should reject.
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("add_function_parameter", PARAMFIX,
                   target_id="module/Worker.class",
                   new_name="c")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_wrong_node_kind_on_return_target(self):
        # Inner statement target — should also reject.
        return_id = _first_id_of_type(PARAMFIX, cst.Return)
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("add_function_parameter", PARAMFIX,
                   target_id=return_id,
                   new_name="c")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_invalid_identifier_starting_with_digit(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("add_function_parameter", PARAMFIX,
                   target_id="module/two_params.fn",
                   new_name="1bad")
        self.assertEqual(_err_kind(ctx.exception), "invalid_identifier")

    def test_invalid_identifier_with_hyphen(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("add_function_parameter", PARAMFIX,
                   target_id="module/two_params.fn",
                   new_name="bad-name")
        self.assertEqual(_err_kind(ctx.exception), "invalid_identifier")

    def test_target_not_found_on_missing_function(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("add_function_parameter", PARAMFIX,
                   target_id="module/does_not_exist.fn",
                   new_name="c")
        self.assertEqual(_err_kind(ctx.exception), "target_not_found")

    def test_target_not_found_on_missing_anchor(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("add_function_parameter", PARAMFIX,
                   target_id="module/two_params.fn",
                   new_name="c",
                   position="before:nonexistent")
        self.assertEqual(_err_kind(ctx.exception), "target_not_found")

    def test_target_not_found_on_invalid_position_string(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("add_function_parameter", PARAMFIX,
                   target_id="module/two_params.fn",
                   new_name="c",
                   position="middle")
        self.assertEqual(_err_kind(ctx.exception), "target_not_found")

    def test_diff_confinement_under_black(self):
        """black canonicalises `c = 42` → `c=42`; the rest of the file must
        remain byte-equivalent (per format-and-diff verification)."""
        out = cst_rewrite.apply(
            source=PARAMFIX, op="add_function_parameter",
            target_id="module/two_params.fn",
            new_source=None, new_name="c",
            default_value="42",
            do_format=True, do_diff_check=True,
        )
        # Canonical form after black
        self.assertIn("def two_params(a, b, c=42):", out)
        # Nothing else moved
        self.assertIn("def with_defaults(x, y=5):", out)
        self.assertIn("def no_params():", out)

    def test_diff_confinement_works_on_method(self):
        out = cst_rewrite.apply(
            source=PARAMFIX, op="add_function_parameter",
            target_id="module/Worker.class/run.fn",
            new_source=None, new_name="timeout",
            type_annotation="int",
            do_format=True, do_diff_check=True,
        )
        self.assertIn("def run(self, payload, timeout: int):", out)


# ── M18.2: op_replace_function_body / op_replace_module_body ────────────
#
# PLAN-v3-revised §A.4. Whole-scope replace ops backing Mode A. The three
# guards: format-and-diff confinement (faithful to M2 — diff vs the raw
# pre-edit source), import-hoisting (used / placed / not-duplicated), and
# the diff returned to the caller for the Mode-B approval gate. New
# errorKind member: unused_import.

RFB = textwrap.dedent(
    '''\
    """demo module."""

    import argparse


    def helper(x):
        return x + 1


    def main():
        parser = argparse.ArgumentParser()
        args = parser.parse_args()
        return args
    '''
)


def _rfb(target_id, new_source, allow_sig=False, fmt=True, diff=True, source=RFB):
    return cst_rewrite.apply(
        source=source, op="replace_function_body",
        target_id=target_id, new_source=new_source, new_name=None,
        do_format=fmt, do_diff_check=diff,
        allow_signature_change=allow_sig,
    )


class TestReplaceFunctionBody(unittest.TestCase):

    # ── happy paths ──────────────────────────────────────────────
    def test_body_edit_changes_body_keeps_signature(self):
        out = _rfb("module/helper.fn", "def helper(x):\n    y = x + 1\n    return y\n")
        self.assertIn("y = x + 1", out)
        self.assertIn("def helper(x):", out)
        # untouched neighbour survives
        self.assertIn("def main():", out)

    def test_import_hoist_used_import_moves_to_block(self):
        out = _rfb(
            "module/main.fn",
            'def main():\n    import sys\n    parser = argparse.ArgumentParser()\n'
            '    args = parser.parse_args()\n    sys.stdout.write("hi")\n    return args\n',
        )
        # hoisted above, into the import block (before the first def)…
        self.assertLess(out.index("import sys"), out.index("def helper"))
        # …and removed from the function body (not left as a local import)
        main_body = out[out.index("def main():"):]
        self.assertNotIn("import sys", main_body)
        self.assertIn('sys.stdout.write("hi")', out)

    def test_signature_change_allowed_with_flag(self):
        out = _rfb(
            "module/main.fn",
            "def main(verbose):\n    parser = argparse.ArgumentParser()\n"
            "    args = parser.parse_args()\n    return args\n",
            allow_sig=True,
        )
        self.assertIn("def main(verbose):", out)

    def test_duplicate_import_is_not_hoisted(self):
        # argparse is already imported at module scope → the user's in-body
        # `import argparse` is a no-op hoist; no second module import added.
        out = _rfb(
            "module/main.fn",
            "def main():\n    import argparse\n    parser = argparse.ArgumentParser()\n"
            "    args = parser.parse_args()\n    return args\n",
        )
        module_head = out[: out.index("def helper")]
        self.assertEqual(module_head.count("import argparse"), 1)

    def test_round_trips_clean_for_noop_body_edit(self):
        out = _rfb("module/helper.fn", "def helper(x):\n    return x + 1\n")
        self.assertTrue(out.endswith("\n"))

    # ── errorKinds ───────────────────────────────────────────────
    def test_parse_error_on_invalid_python(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _rfb("module/helper.fn", "def helper(x):\n    return (((\n")
        self.assertEqual(_err_kind(ctx.exception), "parse_error")

    def test_wrong_node_kind_on_signature_change_without_flag(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _rfb("module/main.fn",
                 "def main(verbose):\n    parser = argparse.ArgumentParser()\n"
                 "    args = parser.parse_args()\n    return args\n")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_wrong_node_kind_on_two_functions(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _rfb("module/helper.fn",
                 "def helper(x):\n    return x\n\n\ndef sneaky():\n    return 0\n")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_wrong_node_kind_when_new_source_is_a_class(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _rfb("module/helper.fn", "class Helper:\n    pass\n")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_wrong_node_kind_when_target_is_not_a_function(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _rfb("module/main.fn/parser.assign", "def main():\n    return 1\n")
        self.assertEqual(_err_kind(ctx.exception), "wrong_node_kind")

    def test_unused_import_is_rejected(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _rfb("module/main.fn",
                 "def main():\n    import os\n    parser = argparse.ArgumentParser()\n"
                 "    args = parser.parse_args()\n    return args\n")
        self.assertEqual(_err_kind(ctx.exception), "unused_import")

    def test_target_not_found_on_bad_id(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _rfb("module/nope.fn", "def nope():\n    return 1\n")
        self.assertEqual(_err_kind(ctx.exception), "target_not_found")

    def test_diff_confinement_failed_on_distant_line_change(self):
        # A change to PI (outside the replaced function's span) is refused.
        src = '"""m."""\n\nimport os\nPI = 3.14\n\n\ndef main():\n    return 1\n'
        with _pipeline_that_corrupts("PI = 3.14", "PI = 9.99"):
            with self.assertRaises(cst_rewrite.OpError) as ctx:
                _rfb("module/main.fn", "def main():\n    return 2\n", source=src)
        self.assertEqual(_err_kind(ctx.exception), "diff_confinement_failed")
        # the diff is surfaced so the panel can show what was rejected
        self.assertIsNotNone(getattr(ctx.exception, "diff", None))

    def test_unclean_distant_line_no_longer_blocks_the_edit(self):
        # M-DIRTY: the same shape with a genuinely non-black-clean distant
        # line (PI=3.14) now SUCCEEDS — black is scoped to the replaced
        # function, so the untouched line is neither reformatted nor a
        # reason to refuse — and that line survives byte-identical.
        ugly = '"""m."""\n\nimport os\nPI=3.14\n\n\ndef main():\n    return 1\n'
        out = _rfb("module/main.fn", "def main():\n    return 2\n", source=ugly)
        self.assertIn("PI=3.14", out)
        self.assertIn("return 2", out)

    # ── indented METHOD source (the editor slices raw file lines) ────────
    _CLASS_SRC = textwrap.dedent(
        '''\
        class C:
            def forward(self, x):
                """doc."""
                x = self.hidden(x)
                return self.head(x)
        '''
    )

    def test_method_body_edit_accepts_indented_source(self):
        # Regression: a method's buffer arrives INDENTED at its class-body
        # level (`    def forward(...)`), which is invalid at module scope —
        # adding a `# test` comment then raised "Syntax Error @ 2:5". The op
        # now dedents before parsing; libcst re-indents on splice.
        indented = (
            "    def forward(self, x):\n"
            '        """doc."""\n'
            "        x = self.hidden(x)\n"
            "        # test\n"
            "        return self.head(x)\n"
        )
        out = _rfb("module/C.class/forward.fn", indented, source=self._CLASS_SRC)
        self.assertIn("# test", out)
        # re-indented back to the method's 4-space class-body level (not col 0)
        self.assertIn("    def forward(self, x):", out)
        self.assertIn("        # test", out)
        self.assertNotIn("\ndef forward", out)  # never leaked to module scope

    def test_dedent_is_noop_for_top_level_function(self):
        # An already-col-0 function is unchanged by the dedent.
        out = _rfb("module/helper.fn", "def helper(x):\n    # note\n    return x + 1\n")
        self.assertIn("def helper(x):", out)
        self.assertIn("    # note", out)


class TestAppendArgOnAssignment(unittest.TestCase):
    """M18.5 — append_keyword_arg / append_positional_arg reach the call on
    an assignment's RHS (e.g. `create = sub.add_parser(...)`), so Mode B's
    'add an argument to the X subparser' can target the assignment node."""

    SRC = "x = make(1)\n"

    def test_keyword_arg_on_assignment_rhs_call(self):
        out = cst_rewrite.apply(
            source=self.SRC, op="append_keyword_arg",
            target_id="module/x.assign", new_source="None", new_name="flag",
            do_format=True, do_diff_check=True,
        )
        self.assertIn("x = make(1, flag=None)", out)

    def test_positional_arg_on_assignment_rhs_call(self):
        out = cst_rewrite.apply(
            source=self.SRC, op="append_positional_arg",
            target_id="module/x.assign", new_source="2",
            new_name=None, do_format=True, do_diff_check=True,
        )
        self.assertIn("x = make(1, 2)", out)


class TestReplaceModuleBody(unittest.TestCase):

    def test_replaces_whole_module(self):
        out = cst_rewrite.apply(
            source=RFB, op="replace_module_body",
            target_id=None, new_source='"""new."""\n\n\ndef only():\n    return 1\n',
            new_name=None, do_format=True, do_diff_check=True,
        )
        self.assertIn("def only():", out)
        self.assertNotIn("def helper", out)

    def test_parse_error_on_invalid_module(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            cst_rewrite.apply(
                source=RFB, op="replace_module_body",
                target_id=None, new_source="def (((\n",
                new_name=None, do_format=True, do_diff_check=True,
            )
        self.assertEqual(_err_kind(ctx.exception), "parse_error")


class TestReplaceBodyCLI(unittest.TestCase):
    """End-to-end through main(): success JSON carries diff + newSource."""

    def _run(self, source, args, stdin):
        import json as _json
        import os as _os
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(source)
            path = f.name
        try:
            env = {**_os.environ, "PYTHONPATH": f"{ROOT / '.pydeps'}:{ROOT / 'scripts'}"}
            proc = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "cst_rewrite.py"), path, *args],
                input=stdin.encode(), capture_output=True, env=env, timeout=30,
            )
            with open(path) as wf:
                written = wf.read()
            return _json.loads(proc.stdout.decode()), written
        finally:
            _os.unlink(path)

    def test_success_payload_has_diff_and_new_source(self):
        result, written = self._run(
            RFB, ["replace_function_body", "module/helper.fn"],
            "def helper(x):\n    return x + 2\n",
        )
        self.assertTrue(result["success"])
        self.assertIn("diff", result)
        self.assertIn("newSource", result)
        self.assertIn("return x + 2", result["newSource"])
        self.assertEqual(written, result["newSource"])


class TestEmptySourceGuard(TestReplaceBodyCLI):
    """M10R — empty stdin on a source-consuming op is rejected, never a
    silent delete. Found live: the MCP rewrite tool's documented payload
    shape left new_source empty; replace_node applied it as a deletion
    that passed diff confinement and reported success."""

    # `target` sits between two keepers: delete_node on a trailing node
    # legitimately trips diff confinement (its leading blank lines fold
    # into the preceding span), which would muddy what this class tests.
    SRC = (
        "def keep(x):\n    return x\n\n\n"
        "def target(y):\n    return y * 2\n\n\n"
        "def keep2(z):\n    return z\n"
    )

    def test_replace_node_empty_stdin_is_rejected_not_deleted(self):
        result, written = self._run(
            self.SRC, ["replace_node", "module/target.fn"], "",
        )
        self.assertFalse(result["success"])
        self.assertEqual(result["errorKind"], "empty_source")
        self.assertEqual(written, self.SRC)  # file untouched

    def test_replace_node_whitespace_only_is_rejected(self):
        result, written = self._run(
            self.SRC, ["replace_node", "module/target.fn"], "   \n\n",
        )
        self.assertFalse(result["success"])
        self.assertEqual(result["errorKind"], "empty_source")
        self.assertEqual(written, self.SRC)

    def test_insert_before_empty_stdin_is_rejected(self):
        result, written = self._run(
            self.SRC, ["insert_before", "module/target.fn"], "",
        )
        self.assertFalse(result["success"])
        self.assertEqual(result["errorKind"], "empty_source")
        self.assertEqual(written, self.SRC)

    def test_replace_function_body_empty_stdin_is_rejected(self):
        result, written = self._run(
            self.SRC, ["replace_function_body", "module/target.fn"], "",
        )
        self.assertFalse(result["success"])
        self.assertEqual(result["errorKind"], "empty_source")
        self.assertEqual(written, self.SRC)

    def test_delete_node_remains_the_explicit_path(self):
        result, written = self._run(
            self.SRC, ["delete_node", "module/target.fn"], "",
        )
        self.assertTrue(result["success"])
        self.assertNotIn("def target", written)
        self.assertIn("def keep(", written)
        self.assertIn("def keep2(", written)


# ── Plan-v7 Stage 1a (G1): dry-run ≡ wet-write ──────────────────────────
#
# The preview-before-write loop's ENTIRE honesty claim is "the ghost the user
# accepts == exactly what gets written." That holds only because --dry-run and
# the wet write emit the SAME `out` from the SAME apply() (diff-confinement runs
# BEFORE the dry/wet branch in main()). This is the required done-gate: prove it
# byte-for-byte, don't assume it. See PLAN-v7.md Stage 1 → Done G1.

class TestDryRunEqualsWet(unittest.TestCase):

    def _spawn(self, source, args, stdin, dry):
        import os as _os
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(source)
            path = f.name
        try:
            env = {**_os.environ, "PYTHONPATH": f"{ROOT / '.pydeps'}:{ROOT / 'scripts'}"}
            argv = [sys.executable, str(ROOT / "scripts" / "cst_rewrite.py"), path, *args]
            if dry:
                argv.append("--dry-run")
            proc = subprocess.run(
                argv, input=stdin.encode(), capture_output=True, env=env, timeout=30,
            )
            with open(path) as wf:
                on_disk = wf.read()
            return proc.stdout.decode(), on_disk
        finally:
            _os.unlink(path)

    # A black-clean fixture: the ONLY change an op makes is its own insertion,
    # so confinement passes and dry≡wet is testable without black noise. (SAMPLE
    # is deliberately not black-clean, which is why the _apply tests format OFF.)
    CLEAN = (
        "def greet(name):\n"
        '    return f"hello, {name}!"\n'
        "\n\n"
        "def compute(x):\n"
        "    return x + 1\n"
    )
    NEW_FN = 'def farewell(name):\n    return f"goodbye, {name}!"\n'

    def test_dry_output_equals_wet_written_file_byte_for_byte(self):
        # Same op + input, once dry, once wet — a real insert_after (the op the
        # compose loop uses). The dry stdout (the previewed source == the ghost)
        # MUST equal the wet-written file exactly.
        args = ["insert_after", "module/greet.fn"]
        dry_stdout, _ = self._spawn(self.CLEAN, args, self.NEW_FN, dry=True)
        wet_stdout, disk_after_wet = self._spawn(self.CLEAN, args, self.NEW_FN, dry=False)

        # wet succeeded
        import json as _json
        self.assertTrue(_json.loads(wet_stdout)["success"])
        # the whole point: preview === commit, byte-for-byte
        self.assertEqual(dry_stdout, disk_after_wet)
        # and the new function actually landed (a real insert, not a no-op)
        self.assertIn("def farewell(name):", disk_after_wet)

    def test_dry_run_never_writes(self):
        # Preview must not touch disk. The file after a dry-run is byte-identical
        # to the input — the honest IR upstream stays honest until accept.
        _, disk_after_dry = self._spawn(
            self.CLEAN, ["insert_after", "module/greet.fn"], self.NEW_FN, dry=True
        )
        self.assertEqual(disk_after_dry, self.CLEAN)

    def test_confinement_failure_is_identical_in_dry_and_wet(self):
        # A diff-confinement-failing op must be rejected identically on both
        # paths (apply() raises before the dry/wet branch), and neither writes.
        #
        # This runs through the CLI, so the in-process corrupting helpers
        # are unavailable. The fixture is a GENUINE escape that no format
        # candidate can rescue: a FunctionDef's structural span starts at
        # its `def` line, but replacing the node also replaces its
        # decorators — so swapping in an undecorated function really does
        # delete the `@functools.cache` line above the span. That is the
        # guard working, not formatter noise, which is why dropping black
        # (the last candidate) cannot make it pass.
        ugly = "import functools\n\n\n@functools.cache\ndef helper(x):\n    return x + 1\n"
        args = ["replace_node", "module/helper.fn"]
        new = "def helper(x):\n    return x + 2\n"
        dry_stdout, disk_after_dry = self._spawn(ugly, args, new, dry=True)
        wet_stdout, disk_after_wet = self._spawn(ugly, args, new, dry=False)

        import json as _json
        dry_json, wet_json = _json.loads(dry_stdout), _json.loads(wet_stdout)
        self.assertFalse(dry_json["success"])
        self.assertFalse(wet_json["success"])
        # replace_node is pre-M12.1, so it keeps the plain-RuntimeError
        # contract (no errorKind); the message still proves the rejection
        # was the confinement guard. errorKind coverage for confinement
        # lives in TestErrorKindTaxonomyCoverage.
        self.assertIn("diff escapes target span", dry_json["error"])
        self.assertIn("diff escapes target span", wet_json["error"])
        self.assertEqual(dry_stdout, wet_stdout)
        # neither path wrote
        self.assertEqual(disk_after_dry, ugly)
        self.assertEqual(disk_after_wet, ugly)


class TestDirtyFileEdits(unittest.TestCase):
    """
    M-DIRTY — targeted edits on files that are NOT already black-clean.

    Before this, whole-file black reformatted lines far from the edit and
    the confinement check refused the write, so EVERY op on real-world code
    failed with diff_confinement_failed (evidence:
    reviews/modify-showdown-2026-08/, where the chat fell back to raw file
    writes and left the CST safety story entirely). Black is now offered
    the edited span first, with whole-file formatting kept as a fallback
    candidate; the confinement check is unchanged and still gates both.

    The invariant these tests pin: an accepted edit leaves every byte
    outside the target span EXACTLY as it was, dirt included.
    """

    # Deliberately un-black-clean in several distinct ways, all far from
    # the functions the tests edit.
    DIRTY = (
        '"""m."""\n'
        "import os\n"
        "\n"
        "PI=3.14\n"
        "LOOKUP  =  {'a':1}\n"
        "\n"
        "\n"
        "def alpha( x ):\n"
        "    return x+1\n"
        "\n"
        "\n"
        "def beta(y):\n"
        "    z  =  y * 2\n"
        "    return z\n"
    )

    def _outside(self, text, drop_start, drop_end):
        """Lines of `text` outside the 1-indexed inclusive span."""
        lines = text.splitlines()
        return lines[: drop_start - 1], lines[drop_end:]

    def test_replace_node_succeeds_and_preserves_dirty_bytes(self):
        out = cst_rewrite.apply(
            source=self.DIRTY, op="replace_node", target_id="module/beta.fn",
            new_source="def beta(y):\n    z  =  y * 3\n    return z\n",
            new_name=None, do_format=True, do_diff_check=True,
        )
        # The edit landed and was formatted inside its own span.
        self.assertIn("z = y * 3", out)
        # Every dirty line outside the target survives byte-identical.
        for dirty_line in ("PI=3.14", "LOOKUP  =  {'a':1}", "def alpha( x ):", "    return x+1"):
            self.assertIn(dirty_line, out)

    def test_head_and_tail_are_byte_identical(self):
        # beta is the LAST def; alpha (dirty) is entirely in the head.
        out = cst_rewrite.apply(
            source=self.DIRTY, op="replace_node", target_id="module/beta.fn",
            new_source="def beta(y):\n    return y\n",
            new_name=None, do_format=True, do_diff_check=True,
        )
        head_pre, _ = self._outside(self.DIRTY, 12, 14)
        head_post = out.splitlines()[: len(head_pre)]
        self.assertEqual(head_pre, head_post)

    def test_insert_before_on_dirty_file(self):
        out = cst_rewrite.apply(
            source=self.DIRTY, op="insert_before", target_id="module/beta.fn",
            new_source="def gamma():\n    return 0\n",
            new_name=None, do_format=True, do_diff_check=True,
        )
        self.assertIn("def gamma():", out)
        self.assertIn("PI=3.14", out)
        self.assertIn("def alpha( x ):", out)

    def test_append_end_on_dirty_file(self):
        out = cst_rewrite.apply(
            source=self.DIRTY, op="append_end",
            target_id=None, new_source="def omega():\n    return 1\n",
            new_name=None, do_format=True, do_diff_check=True,
        )
        self.assertIn("def omega():", out)
        self.assertIn("PI=3.14", out)

    def test_m12_op_on_dirty_file(self):
        out = cst_rewrite.apply(
            source=self.DIRTY, op="insert_as_last_child", target_id="module/beta.fn",
            new_source="pass\n", new_name=None,
            do_format=True, do_diff_check=True,
        )
        self.assertIn("pass", out)
        self.assertIn("LOOKUP  =  {'a':1}", out)

    def test_replace_function_body_with_hoist_on_dirty_file(self):
        out = cst_rewrite.apply(
            source=self.DIRTY, op="replace_function_body", target_id="module/beta.fn",
            new_source="def beta(y):\n    import json\n    return json.dumps(y)\n",
            new_name=None, do_format=True, do_diff_check=True,
        )
        self.assertIn("import json", out)
        self.assertIn("json.dumps(y)", out)
        # the hoist landed in the module import block, not the body
        self.assertLess(out.index("import json"), out.index("def alpha"))
        # and the dirt is untouched
        self.assertIn("PI=3.14", out)
        self.assertIn("def alpha( x ):", out)

    def test_genuine_out_of_span_change_still_rejected_on_dirty_file(self):
        # The permissiveness is strictly about formatting noise: a real
        # change outside the span is refused on a dirty file too.
        with _pipeline_that_corrupts("PI=3.14", "PI=9.99"):
            with self.assertRaises(RuntimeError):
                cst_rewrite.apply(
                    source=self.DIRTY, op="replace_node", target_id="module/beta.fn",
                    new_source="def beta(y):\n    return y\n",
                    new_name=None, do_format=True, do_diff_check=True,
                )

    def test_dry_run_leaves_no_trace_on_dirty_file(self):
        import os as _os
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(self.DIRTY)
            path = f.name
        try:
            env = {**_os.environ, "PYTHONPATH": f"{ROOT / '.pydeps'}:{ROOT / 'scripts'}"}
            proc = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "cst_rewrite.py"), path,
                 "replace_node", "module/beta.fn", "--dry-run"],
                input=b"def beta(y):\n    return y\n",
                capture_output=True, env=env, timeout=30,
            )
            with open(path) as wf:
                on_disk = wf.read()
            self.assertEqual(on_disk, self.DIRTY)
            self.assertIn("return y", proc.stdout.decode())
        finally:
            _os.unlink(path)

    def test_wet_write_lands_on_disk_with_dirt_intact(self):
        import os as _os
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(self.DIRTY)
            path = f.name
        try:
            env = {**_os.environ, "PYTHONPATH": f"{ROOT / '.pydeps'}:{ROOT / 'scripts'}"}
            proc = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "cst_rewrite.py"), path,
                 "replace_node", "module/beta.fn"],
                input=b"def beta(y):\n    z  =  y * 9\n    return z\n",
                capture_output=True, env=env, timeout=30,
            )
            import json as _json
            self.assertTrue(_json.loads(proc.stdout.decode())["success"])
            with open(path) as wf:
                on_disk = wf.read()
            self.assertIn("z = y * 9", on_disk)          # target formatted
            self.assertIn("PI=3.14", on_disk)            # dirt preserved on disk
            self.assertIn("def alpha( x ):", on_disk)
        finally:
            _os.unlink(path)

    def test_rename_in_scope_does_not_reformat_a_dirty_file(self):
        # rename has NO confinement check (it legitimately touches every
        # reference site), so whole-file black there was unguarded churn.
        out = cst_rewrite.apply(
            source=self.DIRTY, op="rename_in_scope", target_id="module/beta.fn",
            new_source=None, new_name="beta2",
            do_format=True, do_diff_check=True,
        )
        self.assertIn("def beta2(y):", out)
        self.assertIn("PI=3.14", out)
        self.assertIn("LOOKUP  =  {'a':1}", out)
        self.assertIn("def alpha( x ):", out)

    # Real-world files (the Django-admin scale fixture that surfaced this)
    # carry whitespace-only lines. Whole-file black used to strip them
    # everywhere, which masked an asymmetry in the head comparison; with
    # black scoped to the edit they correctly survive outside the target.
    TRAILING_WS = (
        "import os\n"
        "\n"
        "\n"
        "def alpha(x):\n"
        "    y = x\n"
        "    \n"          # whitespace-only line, outside the target below
        "    return y\n"
        "\n"
        "\n"
        "def beta(y):\n"
        "    return y\n"
    )

    def test_trailing_whitespace_outside_target_is_not_an_escape(self):
        # black strips trailing whitespace file-wide even under
        # --line-ranges, so `post` always comes back stripped while `pre`
        # still carries it. That is exactly why the confinement comparison
        # must be right-strip tolerant on BOTH sides: the head compare used
        # to rstrip only `pre`, so every real-world file with a
        # whitespace-only line was refused. The edit must be ACCEPTED and
        # the surrounding code left otherwise intact.
        out = cst_rewrite.apply(
            source=self.TRAILING_WS, op="replace_node", target_id="module/beta.fn",
            new_source="def beta(y):\n    return y * 2\n",
            new_name=None, do_format=True, do_diff_check=True,
        )
        self.assertIn("return y * 2", out)
        self.assertIn("def alpha(x):", out)
        self.assertIn("    y = x", out)
        self.assertIn("    return y", out)

    def test_head_rstrip_tolerance_matches_tail(self):
        # The head and tail comparisons must agree about trailing
        # whitespace; only the head used to differ.
        pre = "a = 1\n   \nb = 2\n"
        post = "a = 1\n\nb = 2\n"          # whitespace-only line stripped
        cst_rewrite._verify_diff_confined(pre, post, (3, 3), "replace_node")  # head
        cst_rewrite._verify_diff_confined(pre, post, (1, 1), "replace_node")  # tail

    # ── the escape ladder: refusals must be recoverable, not dead ends ──
    #
    # Before this, a refusal left the chat's Claude with no sanctioned way
    # to finish the task, so it fell back to raw file writes and silently
    # left the CST path (reviews/modify-showdown-2026-08/). Dropping black
    # removes the only thing writing outside the target, so the same edit
    # lands with the SAME confinement check enforced.

    # Black normalises comment spacing file-wide whatever --line-ranges is
    # given, which is the largest single cause of residual refusals.
    COMMENT_DIRT = (
        "import os\n"
        "\n"
        "#----------------\n"
        "# a section banner black would respace\n"
        "#----------------\n"
        "\n"
        "\n"
        "def beta(y):\n"
        "    return y\n"
    )

    def test_refusal_is_recovered_unformatted(self):
        report = {}
        out = cst_rewrite.apply(
            source=self.COMMENT_DIRT, op="replace_node", target_id="module/beta.fn",
            new_source="def beta(y):\n    return y * 2\n",
            new_name=None, do_format=True, do_diff_check=True, report=report,
        )
        self.assertIn("return y * 2", out)
        # the banner comments black wanted to respace are untouched
        self.assertIn("#----------------", out)
        # and the caller is told this edit was not reformatted
        self.assertIs(report.get("formatted"), False)

    def test_formatted_edits_still_report_formatted(self):
        report = {}
        cst_rewrite.apply(
            source=self.DIRTY, op="replace_node", target_id="module/beta.fn",
            new_source="def beta(y):\n    z  =  y * 3\n    return z\n",
            new_name=None, do_format=True, do_diff_check=True, report=report,
        )
        self.assertIs(report.get("formatted"), True)

    def test_unformatted_candidate_still_faces_the_check(self):
        # The ladder relaxes FORMATTING, never verification: damage the
        # pipeline produces is present unformatted too, and still refused.
        with _pipeline_that_corrupts("import os", "import ossify"):
            with self.assertRaises(RuntimeError):
                cst_rewrite.apply(
                    source=self.COMMENT_DIRT, op="replace_node",
                    target_id="module/beta.fn",
                    new_source="def beta(y):\n    return y * 2\n",
                    new_name=None, do_format=True, do_diff_check=True,
                )

    def test_corrupting_formatter_is_recovered_not_written(self):
        # Deliberate behaviour change: a formatter that damages out-of-span
        # content no longer fails the edit — the unformatted candidate is
        # used instead, so the corruption never reaches disk.
        report = {}
        out = cst_rewrite.apply(
            source=self.DIRTY, op="replace_node", target_id="module/beta.fn",
            new_source="def beta(y):\n    return y\n",
            new_name=None, do_format=True, do_diff_check=True, report=report,
        )
        self.assertIn("return y", out)
        with _formatter_that_corrupts("PI=3.14", "PI=9.99"):
            report2 = {}
            out2 = cst_rewrite.apply(
                source=self.DIRTY, op="replace_node", target_id="module/beta.fn",
                new_source="def beta(y):\n    return y\n",
                new_name=None, do_format=True, do_diff_check=True, report=report2,
            )
        self.assertIn("PI=3.14", out2)          # corruption never landed
        self.assertIs(report2.get("formatted"), False)

    def test_genuine_escape_is_still_refused_by_every_candidate(self):
        # Replacing a decorated function with an undecorated one really
        # does delete the decorator line above the span. No candidate can
        # rescue that, and none should.
        src = "import functools\n\n\n@functools.cache\ndef helper(x):\n    return x + 1\n"
        with self.assertRaises(RuntimeError):
            cst_rewrite.apply(
                source=src, op="replace_node", target_id="module/helper.fn",
                new_source="def helper(x):\n    return x + 2\n",
                new_name=None, do_format=True, do_diff_check=True,
            )

    # Rehearsal-3 (pump-lab-3): replacing a METHOD failed with a bare
    # ParserSyntaxError because the caller sent the method at its
    # class-body indentation — which is how it reads in the file, and what
    # any caller naturally echoes back. replace_function_body already
    # dedented; replace_node did not, so identical text was accepted by one
    # op and rejected by the other.
    METHOD_SRC = (
        "import torch.nn as nn\n"
        "\n"
        "\n"
        "class Net(nn.Module):\n"
        "    def __init__(self):\n"
        "        super().__init__()\n"
        "        self.net = nn.Sequential(nn.Linear(8, 4), nn.ReLU())\n"
    )

    def test_method_source_may_arrive_indented(self):
        out = cst_rewrite.apply(
            source=self.METHOD_SRC, op="replace_node",
            target_id="module/Net.class/__init__.fn",
            # Sent at class-body indentation, exactly as it appears in the file.
            new_source=(
                "    def __init__(self):\n"
                "        super().__init__()\n"
                "        self.net = nn.Sequential(nn.Linear(8, 4), nn.ReLU(), nn.Dropout(0.2))\n"
            ),
            new_name=None, do_format=True, do_diff_check=True,
        )
        assert "nn.Dropout(0.2)" in out
        # Re-indented back to its class body, not flattened to module scope.
        assert "\n    def __init__(self):" in out
        assert "\nclass Net(nn.Module):" in out

    def test_column_zero_source_is_unaffected_by_the_dedent(self):
        # textwrap.dedent strips only the COMMON prefix, so a top-level
        # function sent at column 0 must round-trip unchanged.
        out = cst_rewrite.apply(
            source="def a(x):\n    return x\n", op="replace_node",
            target_id="module/a.fn",
            new_source="def a(x):\n    return x * 2\n",
            new_name=None, do_format=True, do_diff_check=True,
        )
        assert "return x * 2" in out
        assert out.startswith("def a(x):")

    def test_clean_file_behaviour_is_unchanged(self):
        # The never-worse property: on an already-clean file the pipeline
        # still produces canonical black output. Targeting the last import
        # of the leading block is the case where scoped formatting alone
        # would misplace blank lines — the whole-file fallback covers it.
        clean = "import argparse\nimport sys\n\n\ndef helper(x):\n    return x + 1\n"
        out = cst_rewrite.apply(
            source=clean, op="replace_node", target_id="module/sys.import",
            new_source="import sys\n", new_name=None,
            do_format=True, do_diff_check=True,
        )
        self.assertEqual(out, clean)


class TestCreateFile(unittest.TestCase):
    """
    PLAN-v7 4a — the greenfield create_file op. The one op whose target must
    NOT exist (creation only, never overwrite). Guards ratified in the
    Stage-4 decision conversation: file_exists / invalid_path (.py suffix,
    parent dir) / empty_source / parse_error; content black-formatted;
    dry ≡ wet byte-for-byte (the changeset-gate honesty claim).
    """

    CONTENT = (
        "def insert_note(title):\n"
        '    return {"title": title}\n'
    )

    def _spawn(self, path, stdin, dry=False, op_args=()):
        import os as _os
        import subprocess
        env = {**_os.environ, "PYTHONPATH": f"{ROOT / '.pydeps'}:{ROOT / 'scripts'}"}
        argv = [sys.executable, str(ROOT / "scripts" / "cst_rewrite.py"), path, "create_file", *op_args]
        if dry:
            argv.append("--dry-run")
        proc = subprocess.run(
            argv, input=stdin.encode(), capture_output=True, env=env, timeout=30,
        )
        return proc.stdout.decode()

    def _tmpdir(self):
        import tempfile
        d = tempfile.mkdtemp(prefix="vg-create-")
        self.addCleanup(__import__("shutil").rmtree, d, ignore_errors=True)
        return d

    def test_creates_formatted_file_and_surfaces_new_source(self):
        import json as _json
        import os as _os
        d = self._tmpdir()
        path = _os.path.join(d, "db.py")
        out = _json.loads(self._spawn(path, self.CONTENT))
        self.assertTrue(out["success"])
        with open(path) as f:
            disk = f.read()
        # the whole file is the surfaced diff — newSource === what was written
        self.assertEqual(out["newSource"], disk)
        self.assertIn("def insert_note(title):", disk)

    def test_dry_equals_wet_and_dry_never_writes(self):
        import os as _os
        d = self._tmpdir()
        path = _os.path.join(d, "db.py")
        dry_stdout = self._spawn(path, self.CONTENT, dry=True)
        self.assertFalse(_os.path.exists(path), "dry-run must not create the file")
        self._spawn(path, self.CONTENT, dry=False)
        with open(path) as f:
            disk = f.read()
        self.assertEqual(dry_stdout, disk)

    def test_refuses_existing_path(self):
        import json as _json
        import os as _os
        d = self._tmpdir()
        path = _os.path.join(d, "exists.py")
        with open(path, "w") as f:
            f.write("x = 1\n")
        for dry in (True, False):
            out = _json.loads(self._spawn(path, self.CONTENT, dry=dry))
            self.assertFalse(out["success"])
            self.assertEqual(out["errorKind"], "file_exists")
        with open(path) as f:
            self.assertEqual(f.read(), "x = 1\n")  # untouched

    def test_invalid_path_non_py_traversal_and_blocked_parent(self):
        import json as _json
        import os as _os
        d = self._tmpdir()
        out = _json.loads(self._spawn(_os.path.join(d, "notes.txt"), self.CONTENT))
        self.assertFalse(out["success"])
        self.assertEqual(out["errorKind"], "invalid_path")
        # A ".." segment is refused outright (traversal-free paths are what
        # keep the server's root containment sound with parent creation on).
        out = _json.loads(self._spawn(_os.path.join(d, "..", "esc.py"), self.CONTENT))
        self.assertFalse(out["success"])
        self.assertEqual(out["errorKind"], "invalid_path")
        # A parent blocked by an existing FILE cannot be created.
        blocker = _os.path.join(d, "blocker")
        with open(blocker, "w") as f:
            f.write("not a dir")
        out = _json.loads(self._spawn(_os.path.join(blocker, "x.py"), self.CONTENT))
        self.assertFalse(out["success"])
        self.assertEqual(out["errorKind"], "invalid_path")

    def test_missing_parents_are_created(self):
        # OPUS-SHOWDOWN finding (2026-08-02): a package layout
        # (pkg/sub/mod.py) must not fail the floor — parents are created.
        import json as _json
        import os as _os
        d = self._tmpdir()
        path = _os.path.join(d, "pkg", "sub", "mod.py")
        out = _json.loads(self._spawn(path, self.CONTENT))
        self.assertTrue(out["success"], out)
        self.assertTrue(_os.path.isfile(path))
        # Dry-run leaves NO trace — neither the file nor the directories
        # (creation happens on the wet path only).
        path2 = _os.path.join(d, "pkg2", "mod.py")
        self._spawn(path2, self.CONTENT, dry=True)
        self.assertFalse(_os.path.exists(path2))
        self.assertFalse(_os.path.isdir(_os.path.join(d, "pkg2")))

    def test_empty_source_and_parse_error(self):
        import json as _json
        import os as _os
        d = self._tmpdir()
        out = _json.loads(self._spawn(_os.path.join(d, "a.py"), "   \n"))
        self.assertFalse(out["success"])
        self.assertEqual(out["errorKind"], "empty_source")
        out = _json.loads(self._spawn(_os.path.join(d, "b.py"), "def broken(:\n"))
        self.assertFalse(out["success"])
        self.assertEqual(out["errorKind"], "parse_error")
        self.assertFalse(_os.path.exists(_os.path.join(d, "a.py")))
        self.assertFalse(_os.path.exists(_os.path.join(d, "b.py")))


# ── capture_probe (M-RUN3) ─────────────────────────────────────────────


CAPTURE_SAMPLE = textwrap.dedent(
    '''\
    def evaluate(model, x):
        score = compute(model, x)
        return score / len(x)


    def report(x):
        print(x)


    def bail():
        return


    def multi():
        return (
            1
            + 2
        )
    '''
)


class TestCaptureProbe(unittest.TestCase):

    def test_return_value_is_captured_and_probed(self):
        out = _apply("capture_probe", CAPTURE_SAMPLE,
                     target_id="module/evaluate.fn/return@0", new_name="__vg_value")
        self.assertIn("__vg_value = (score / len(x))", out)
        self.assertIn('print("__VG__::" + __import__("json").dumps(repr(__vg_value)))', out)
        self.assertIn("raise _VGStop()", out)
        self.assertNotIn("return score / len(x)", out)
        # other functions untouched
        self.assertIn("def report(x):\n    print(x)", out)

    def test_expression_statement_call_is_captured(self):
        out = _apply("capture_probe", CAPTURE_SAMPLE,
                     target_id="module/report.fn/print.call", new_name="__vg_value")
        self.assertIn("__vg_value = (print(x))", out)
        self.assertIn("raise _VGStop()", out)
        # the return-path function untouched
        self.assertIn("return score / len(x)", out)

    def test_multiline_return_expression_survives(self):
        out = _apply("capture_probe", CAPTURE_SAMPLE,
                     target_id="module/multi.fn/return@0", new_name="__vg_value")
        # code_for_node keeps the expression valid; the wrapping parens make
        # the multi-line layout legal in the assignment.
        self.assertIn("__vg_value = (", out)
        self.assertIn("raise _VGStop()", out)

    def test_bare_return_is_wrong_node_kind(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("capture_probe", CAPTURE_SAMPLE,
                   target_id="module/bail.fn/return@0", new_name="__vg_value")
        self.assertEqual(ctx.exception.kind, "wrong_node_kind")

    def test_non_capturable_target_is_wrong_node_kind(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("capture_probe", CAPTURE_SAMPLE,
                   target_id="module/evaluate.fn", new_name="__vg_value")
        self.assertEqual(ctx.exception.kind, "wrong_node_kind")

    def test_invalid_capture_variable_is_invalid_identifier(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("capture_probe", CAPTURE_SAMPLE,
                   target_id="module/evaluate.fn/return@0", new_name="not a name")
        self.assertEqual(ctx.exception.kind, "invalid_identifier")

    def test_unknown_target_is_target_not_found(self):
        with self.assertRaises(cst_rewrite.OpError) as ctx:
            _apply("capture_probe", CAPTURE_SAMPLE,
                   target_id="module/nope.fn/return@0", new_name="__vg_value")
        self.assertEqual(ctx.exception.kind, "target_not_found")

    def test_full_pipeline_diff_confined(self):
        """With format+diff ON, the rewrite passes confinement (in-span growth).
        The source must be black-clean — CAPTURE_SAMPLE's hand-wrapped multi()
        is deliberately not (black would reformat it OUTSIDE the target span,
        which confinement rightly rejects), so this uses the clean subset."""
        clean = CAPTURE_SAMPLE.split("def multi():")[0].rstrip("\n") + "\n"
        out = cst_rewrite.apply(
            source=clean, op="capture_probe",
            target_id="module/evaluate.fn/return@0", new_source=None,
            new_name="__vg_value", do_format=True, do_diff_check=True,
        )
        self.assertIn('print("__VG__::" + __import__("json").dumps(repr(__vg_value)))', out)


if __name__ == "__main__":
    unittest.main()
