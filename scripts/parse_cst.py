#!/usr/bin/env python3
"""
CST-based parser for CodeCanvas / VibeGraph.

Single-file mode:
    python3 parse_cst.py <path-to-python-file> [--module-path <dotted.name>]
    Emits JSON: { version, nodes, edges, symbolIndex, modulePath? }

Batch mode (M6 wave 3b — pay libcst's cold-import cost once for a whole
project rather than once per file):
    python3 parse_cst.py --batch
    Reads newline-delimited `<path>\\t<modulePath>` pairs on stdin
    (`<modulePath>` optional; empty string allowed).
    Emits JSON: { files: { path: ir, ... }, errors: { path: msg, ... } }
    Per-file parse errors land in `errors`; the rest of the batch
    continues. The shape matches server.ts's projectParse map.

--module-path is supplied in project mode by server.ts and pinned into the IR
so cross_file_link.py can build a project-wide qualified-symbol index without
re-deriving paths from the filesystem.
"""
import argparse
import json
import sys
from typing import Optional, Union
import libcst as cst
import libcst.metadata as meta  # noqa: F401  (Optional is re-used by helper signatures)
import libcst.matchers as m


# ─────────────────────────────────────────── graph builder ──────────

# Preview cap for RHS / call source snippets. 60 cut real multi-line
# expressions mid-token (a 7-line nn.Sequential(...) lost most of its
# layers), so the diagram cards could never show the full statement; 300
# keeps pathological one-liners bounded while typical multi-line RHS
# survives whole. The schema pins no number — "truncated source" stays true.
PREVIEW_MAX = 300

# M-COMP — the four comprehension forms, and the `compKind` each stamps.
# A generator expression is here with the eager three; see the design note
# on _visit_comprehension for why laziness does not earn it an exemption.
COMPREHENSION_KINDS = {
    cst.ListComp: "list",
    cst.SetComp: "set",
    cst.DictComp: "dict",
    cst.GeneratorExp: "generator",
}
COMPREHENSION_TYPES = tuple(COMPREHENSION_KINDS)
# "no override recorded" — distinct from an override OF None, which is a
# real value meaning module scope.
_NO_OVERRIDE = object()


class GraphBuilder(cst.CSTVisitor):
    METADATA_DEPENDENCIES = (meta.PositionProvider,)

    def __init__(self, module: cst.Module, capture_nodes: bool = False) -> None:
        self.nodes: list[dict] = []
        self.edges: list[dict] = []
        self.symbol_index: list[dict] = []
        # When capture_nodes=True, nodes_by_id maps each emitted node-id to the
        # underlying CST node. Used by cst_rewrite.py to look up patch targets
        # without re-implementing the structural-path-id grammar.
        self.capture_nodes = capture_nodes
        self.nodes_by_id: dict[str, cst.CSTNode] = {}
        self._module = module
        self._parent_stack: list[str] = []
        self._seq: dict[str, int] = {}          # key="parentId:kind" → counter (unnamed nodes)
        self._name_seq: dict[str, int] = {}     # key="parentId:name.kind" → occurrence counter (named nodes)
        self._defs: dict[str, str] = {}         # bare name → node_id (module-scope only)
        # M-SWEEP W1 — every cst.Call that has ALREADY produced a node, by
        # id(). The generic sweep below emits only what these missed, so the
        # specialised emitters (assignment callTarget, return, raise, with,
        # condition) keep their shapes and their parenting exactly.
        self._emitted_calls: set[int] = set()
        # Nesting depth in the Call tree. The sweep fires only at depth 1
        # (OUTERMOST), because nested calls are already handled by
        # _extract_arg_nests / _stamp_nests — emitting them again here would
        # change nesting semantics across every fixture and every consumer.
        self._call_depth = 0
        # M-COMP — a comprehension reached through an expression that runs in
        # the ENCLOSING flow (a `for` iterable, an `if` test) is traversed
        # only AFTER that construct's container has been pushed, so its own
        # container would nest one level too deep. These record where it
        # actually belongs, keyed by CST identity.
        self._comp_outer_parent: dict = {}
        # Saved call depth per open comprehension — see _visit_comprehension.
        self._comp_call_depth: list = []
        # How many containers each open comprehension pushed. A comprehension
        # with several `for` clauses is a NESTED loop and emits one container
        # per clause, so leave cannot assume it pops exactly one.
        self._comp_pushed: list = []
        # M17.2 — set when any of the new control-flow container kinds
        # (try_stmt / except_handler / finally_block / while_loop) get
        # emitted. parse_file() uses this to ratchet the IR version from
        # IR_VERSION_BASE up to IR_VERSION_CONTAINERS so consumers know
        # to expect the new enum members. Files with no try/while keep
        # the baseline version.
        self._uses_containers: bool = False

    # ── helpers ──────────────────────────────────────────────────────

    def _pos(self, node: cst.CSTNode) -> dict:
        p = self.get_metadata(meta.PositionProvider, node)
        return {"line": p.start.line, "endLine": p.end.line,
                "col": p.start.column, "endCol": p.end.column}

    def _code(self, node: cst.CSTNode) -> str:
        try:
            return self._module.code_for_node(node)
        except Exception:
            return "?"

    def _parent_id(self) -> Optional[str]:
        return self._parent_stack[-1] if self._parent_stack else None

    def _next_seq(self, kind: str) -> int:
        prefix = self._parent_id() or "module"
        key = f"{prefix}:{kind}"
        n = self._seq.get(key, 0)
        self._seq[key] = n + 1
        return n

    def _make_id(self, kind_short: str, name: str) -> str:
        parent = self._parent_id()
        if name:
            # Occurrence ordinal within (scope, name, kind): repeated same-name
            # bindings — `x = f(x)` reassignment, ubiquitous in forward() and
            # in Python generally — must get distinct ids or they collapse to a
            # single node (last-write-wins) and every intermediate step is lost.
            # Occurrence 0 stays bare (backward-compatible; single bindings are
            # unchanged), occurrence k>0 → `name.kind@k`. Structural (occurrence
            # index in source order within the scope), NOT a line number.
            prefix = parent or "module"
            key = f"{prefix}:{name}.{kind_short}"
            occ = self._name_seq.get(key, 0)
            self._name_seq[key] = occ + 1
            seg = f"{name}.{kind_short}" if occ == 0 else f"{name}.{kind_short}@{occ}"
        else:
            seg = f"{kind_short}@{self._next_seq(kind_short)}"
        return f"{parent}/{seg}" if parent else f"module/{seg}"

    def _emit(self, node_id: str, node_type: str, pos: dict, cst_node: Optional[cst.CSTNode] = None, **extra) -> None:
        parent_id = self._parent_id()
        self.nodes.append({"id": node_id, "type": node_type, "parentId": parent_id, **pos, **extra})
        if parent_id:
            self.edges.append({"source": parent_id, "target": node_id, "type": "contains"})
        if self.capture_nodes and cst_node is not None:
            self.nodes_by_id[node_id] = cst_node

    def _value_kind(self, v: cst.BaseExpression) -> str:
        if isinstance(v, (cst.Integer, cst.Float, cst.Imaginary)):
            return "scalar"
        if isinstance(v, (cst.SimpleString, cst.ConcatenatedString)):
            return "string"
        if isinstance(v, cst.FormattedString):
            return "fstring"
        if isinstance(v, cst.List):
            return "list"
        if isinstance(v, cst.Tuple):
            return "tuple"
        if isinstance(v, cst.Dict):
            return "dict"
        if isinstance(v, cst.Set):
            return "set"
        if isinstance(v, cst.Call):
            return "call"
        return "other"

    def _target_name(self, t: cst.BaseExpression) -> str:
        if isinstance(t, cst.Name):
            return t.value
        if isinstance(t, cst.Attribute):
            obj = self._target_name(t.value)
            return f"{obj}.{t.attr.value}"
        return "?"

    def _func_name(self, f: cst.BaseExpression) -> str:
        if isinstance(f, cst.Name):
            return f.value
        if isinstance(f, cst.Attribute):
            return f"{self._func_name(f.value)}.{f.attr.value}"
        if isinstance(f, cst.Call):
            return f"{self._func_name(f.func)}()"
        return "?"

    def _param_str(self, p: cst.Param) -> str:
        name = p.name.value
        if p.default is not None:
            return f"{name}={self._code(p.default)}"
        return name

    def _classify_effect_kind(self, target: str) -> Optional[str]:
        """IR 1.3 (M9.1): bucket a callee/callTarget into one of the
        external-effect kinds from PLAN-v2.md §2.1. String-match only,
        no import resolution. Order matters — first match wins. Returns
        None for pure / unknown.

        False positives are tolerated by design (the icon system is for
        scanning, not correctness claims). A function literally named
        `insert` will be flagged db; a method called `query` on a
        dataframe will be flagged db. Users can hide noisy entries
        downstream.
        """
        if not target:
            return None
        # db
        if target in ("cursor.execute", "session.query", "session.add",
                      "session.commit", "session.delete", "session.rollback",
                      "session.flush"):
            return "db"
        if target in ("select", "insert", "update", "delete"):
            return "db"
        if target.startswith("db.session.") or target.startswith("db.engine."):
            return "db"
        # PLAN-v7 6a: opening a DB connection IS an effect (it creates the
        # db file on disk for sqlite). Found via the with-item floor fix —
        # a check chain reaching sqlite3.connect scanned pure.
        if target == "sqlite3.connect":
            return "db"
        if ".objects." in target or target.endswith(".query"):
            return "db"
        # *.execute where receiver is one of {cursor, conn, db, session}
        if target.endswith(".execute"):
            receiver = target[:-len(".execute")].rsplit(".", 1)[-1]
            if receiver in ("cursor", "conn", "db", "session", "connection"):
                return "db"
        # http
        for prefix in ("requests.", "httpx.", "aiohttp.", "urllib3.",
                       "urllib.request."):
            if target.startswith(prefix):
                return "http"
        if target == "urlopen":
            return "http"
        # subprocess (check before fs; subprocess.* sits above os.* / shutil.*)
        for prefix in ("subprocess.", "os.system", "os.exec", "os.popen"):
            if target.startswith(prefix):
                return "subprocess"
        # fs
        if target == "open":
            return "fs"
        for prefix in ("os.path.", "os.makedirs", "os.mkdir", "os.remove",
                       "os.rename", "os.listdir", "shutil.", "pathlib.",
                       "Path."):
            if target.startswith(prefix):
                return "fs"
        # Path(...).read_*, Path(...).write_* — funcName format is
        # "Path().read_text" after _func_name() flattens the call chain.
        if "Path()." in target and (".read_" in target or ".write_" in target):
            return "fs"
        # log
        if target.startswith("logger.") or target.startswith("logging.") \
           or target.startswith("log."):
            return "log"
        return None

    # ── nested-call extraction (M-NEST Layer 1) ───────────────────────
    #
    # The IR was statement-level and one-call-deep: `x = F.relu(self.conv1(x))`
    # exposed only the OUTERMOST call (F.relu); the inner `self.conv1` survived
    # merely as an `args` source string, so the architecture/thread views
    # silently dropped it. We now mint a real `call` node per nested call so the
    # data path is complete and honest.
    #
    # Two scopes, deliberately different widths (the documented stopping rule):
    #   * DETECTOR (`_expr_has_nested_call`) — covers ALL nest forms (arg-nests,
    #     method chains, comprehensions, literal-embedded calls). Drives the
    #     `nestsInnerCalls` honesty flag so deferred forms are badged, never lied
    #     about.
    #   * EXTRACTION (`_extract_arg_nests`) — v1 mints nodes only for calls that
    #     are the direct VALUE of an argument (`F.relu(self.conv1(x))`), recursing
    #     into deeper arg-nesting. Calls buried in binops/literals/comprehensions/
    #     chains are detected-but-not-extracted (v2+ reuses this machinery).

    def _calls_outside_comprehensions(self, value) -> list:
        """Every call in an expression EXCEPT those inside a comprehension.

        Unlike `_once_calls` this keeps descending through a call's own
        subtree — the nest detector wants the hidden ones — but a
        comprehension is not a hiding place any more: it has its own
        container and its own call nodes.
        """
        found: list = []

        def walk(n) -> None:
            if isinstance(n, COMPREHENSION_TYPES):
                return
            if isinstance(n, cst.Call):
                found.append(n)
            for child in n.children:
                walk(child)

        walk(value)
        return found

    def _expr_has_nested_call(self, value: cst.BaseExpression) -> bool:
        """True iff `value` hides a call the outer node would otherwise mask:
        any cst.Call beyond an outermost single call. Covers every nest form.

        M-COMP — EXCEPT inside a comprehension. `nestsInnerCalls` drives the
        view's dashed "path shown incomplete" badge, and after M-COMP a
        comprehension's calls are neither hidden nor undecomposed: they are
        nodes, inside a container, right there in the thread. Counting them
        here would badge `torch.stack([self.head(x) for _ in range(2)])` as
        concealing `self.head` while the reader is looking straight at it —
        a false alarm about our own completeness, which costs exactly the
        trust the badge exists to earn.

        A list LITERAL is unchanged: `f([g(x), h(y)])` really does hide two
        calls behind one step, and still says so.
        """
        all_calls = self._calls_outside_comprehensions(value)
        if not all_calls:
            return False
        # When the value is itself a single outer call, exclude it from the
        # nested set; otherwise (list/binop/…) any contained call is nested.
        return len(all_calls) > 1 if isinstance(value, cst.Call) else True

    def _emit_nested_call(self, call: cst.Call, depth: int) -> int:
        """Emit one nested `call` node (parent = current _parent_id, so _emit
        wires the contains edge outer→inner) and recurse into its call-valued
        args. Returns total nodes minted including this one."""
        self._claim(call)
        func_name = self._func_name(call.func)
        safe = func_name.replace(".", "_").replace("()", "")
        call_id = self._make_id("call", safe)
        # CallNode requires funcName/args/isEffect; mirror visit_Expr's shape so
        # the node validates and the thread extractor's `call` path picks it up.
        args = [self._code(a.value) for a in call.args]
        is_effect = (
            func_name in {"print", "write", "flush", "close"}
            or func_name.endswith(".write")
            or func_name.endswith(".print")
        )
        extras = {
            "funcName": func_name,
            "args": args,
            "isEffect": is_effect,
            # callTarget mirrors funcName so the architecture forwardSeq (which
            # keys on callTarget) surfaces nested layer applications.
            "callTarget": func_name,
            "preview": self._code(call)[:PREVIEW_MAX],
            # `nested`/`nestedDepth` mark this as a sub-node the default
            # projection collapses (the seam guard); depth is 1 for a direct
            # arg-nest, higher for multi-level (self.pool(F.relu(self.conv2(x)))).
            "nested": True,
            "nestedDepth": depth,
        }
        ek = self._classify_effect_kind(func_name)
        if ek is not None:
            extras["effectKind"] = ek
        self._emit(call_id, "call", self._pos(call), cst_node=call, **extras)
        # Reference edge to a known def — same rule as statement-level calls.
        base = func_name.split(".")[0]
        if base in self._defs:
            self.edges.append({"source": call_id, "target": self._defs[base], "type": "reference"})
        minted = 1
        self._parent_stack.append(call_id)
        try:
            for a in call.args:
                if isinstance(a.value, cst.Call):
                    minted += self._emit_nested_call(a.value, depth + 1)
        finally:
            self._parent_stack.pop()
        return minted

    def _extract_arg_nests(self, outer_call: cst.Call, outer_node_id: str) -> int:
        """Mint nested `call` nodes for outer_call's call-valued arguments,
        parented at outer_node_id. Returns the count minted (0 if none)."""
        minted = 0
        self._parent_stack.append(outer_node_id)
        try:
            for a in outer_call.args:
                if isinstance(a.value, cst.Call):
                    minted += self._emit_nested_call(a.value, 1)
                else:
                    # M-SWEEP W1 — an argument that is not ITSELF a call may
                    # still contain one: `max(*[post()])`. That was one of the
                    # last leaks after the generic sweep, because the sweep
                    # only fires at depth 1 and these sit under an outer call
                    # that already produced a node. Minting them here as nests
                    # of that outer call is the same treatment `f(g())` already
                    # gets, so nesting stays one idea rather than two.
                    #
                    # M-COMP — but NOT into a comprehension. `list(post() for
                    # _ in xs)` is a LOOP, not an argument nest: minting
                    # `post` as a nest of `list` put it outside the
                    # comprehension container and hid the repetition. It is
                    # still emitted — the comprehension resets call depth, so
                    # the generic sweep fires on it INSIDE the container. This
                    # also restores what the schema already documented:
                    # `nestExtracted` is false for comprehensions, "detected
                    # but deferred", which the old descent quietly contradicted.
                    for inner in self._once_calls(a.value):
                        minted += self._emit_nested_call(inner, 1)
        finally:
            self._parent_stack.pop()
        return minted

    def _claim(self, call: Optional[cst.BaseExpression]) -> None:
        """Mark a Call as already emitted, so the generic sweep skips it."""
        if isinstance(call, cst.Call):
            self._emitted_calls.add(id(call))

    # M-SWEEP W1 — THE GENERIC EXPRESSION SWEEP.
    #
    # Before this, a call node was emitted only when the call was the DIRECT
    # value of a statement. A call written INSIDE a composite expression
    # produced nothing at all, and scan_effects derives its verdict from the
    # IR — so the effect floor could not see it. Measured against
    # scan_effects itself: 20 of 30 in-function positions leaked, including
    # every comprehension form, `for x in f()`, `assert f()`, `a or f()`,
    # both ternary arms, f-strings, list/dict literal elements, chained
    # comparisons, `not f()` and slice bounds.
    #
    # It was ONE bug, not twenty. `with`, then `if`/`while`, were each
    # patched individually, which is exactly why the class kept coming back.
    # This closes the class: libcst visits every Call, so nothing can be
    # missed by forgetting a position.
    #
    # DEPTH 1 ONLY. A nested call (`f(g())`) is already minted by
    # _extract_arg_nests and stamped by _stamp_nests; sweeping it too would
    # double-emit and change what `nests` means everywhere.
    #
    # PARENTING is whatever _parent_stack holds when traversal reaches the
    # call — which is correct for every position EXCEPT the two where a
    # container is pushed before its own test/iterable is visited. Those
    # (`if`/`while` tests, `for` iterables) emit explicitly BEFORE the push,
    # claim their calls, and are therefore skipped here.
    def visit_Call(self, node: cst.Call) -> None:
        self._call_depth += 1
        if self._call_depth == 1 and id(node) not in self._emitted_calls:
            self._emit_expr_call(node, node)

    def leave_Call(self, node: cst.Call) -> None:
        self._call_depth -= 1

    def _stamp_nests(self, value: cst.BaseExpression, node_id: str,
                     node_dict: dict) -> None:
        """Run detector + extraction for a statement whose value MAY be a call.
        Stamps `nestsInnerCalls` (detector) and `nestExtracted` (did we mint
        ≥1 child) on node_dict. No-op when the value holds no nested call."""
        if not self._expr_has_nested_call(value):
            return
        node_dict["nestsInnerCalls"] = True
        minted = self._extract_arg_nests(value, node_id) if isinstance(value, cst.Call) else 0
        node_dict["nestExtracted"] = minted > 0

    def _docstring(self, body: cst.BaseSuite) -> Optional[str]:
        if not isinstance(body, cst.IndentedBlock) or not body.body:
            return None
        first = body.body[0]
        if not isinstance(first, cst.SimpleStatementLine) or not first.body:
            return None
        stmt = first.body[0]
        if isinstance(stmt, cst.Expr) and isinstance(stmt.value, cst.SimpleString):
            raw = stmt.value.value
            for q in ('"""', "'''", '"', "'"):
                if raw.startswith(q) and raw.endswith(q) and len(raw) > 2 * len(q):
                    return raw[len(q):-len(q)].strip()
            return raw.strip("\"'")
        return None

    # ── visitors: import ─────────────────────────────────────────────

    def visit_Import(self, node: cst.Import) -> None:
        if isinstance(node.names, cst.ImportStar):
            return
        names = []
        for alias in node.names:
            n = self._code(alias.name)
            if alias.asname and hasattr(alias.asname, 'name'):
                n = f"{n} as {self._code(alias.asname.name)}"
            names.append(n)
        if not names:
            return
        node_id = self._make_id("import", names[0].split()[0])
        self._emit(node_id, "import", self._pos(node), cst_node=node, names=names)

    def visit_ImportFrom(self, node: cst.ImportFrom) -> None:
        if isinstance(node.names, cst.ImportStar):
            return
        module_name = self._code(node.module) if node.module else ""
        names = [self._code(a.name) for a in node.names if isinstance(a, cst.ImportAlias)]
        safe_name = module_name.replace(".", "_")
        node_id = self._make_id("import_from", safe_name)
        self._emit(node_id, "import_from", self._pos(node), cst_node=node, module=module_name, names=names)

    # ── visitors: assignment ──────────────────────────────────────────

    def visit_Assign(self, node: cst.Assign) -> None:
        if not node.targets:
            return
        first_target = node.targets[0].target
        name = self._target_name(first_target)
        vkind = self._value_kind(node.value)
        preview = self._code(node.value)[:PREVIEW_MAX]
        safe = name.replace(".", "_")
        node_id = self._make_id("assign", safe)
        # Schema 1.1: record callTarget when value is a direct Call. cross_file_link.py
        # uses this to resolve assignment-RHS calls to imported symbols. Nested calls
        # inside list/tuple/dict literals are NOT exposed here — that's a parser
        # enhancement out of M4a scope.
        extras: dict = {"name": name, "valueKind": vkind, "preview": preview}
        if isinstance(node.value, cst.Call):
            self._claim(node.value)  # the assignment node IS this call's node
            call_target = self._func_name(node.value.func)
            extras["callTarget"] = call_target
            # IR 1.3 (M9.1): classify external-effect kind on the
            # assignment when the RHS is a direct call. Mirrors the
            # bare-call path in visit_Expr.
            ek = self._classify_effect_kind(call_target)
            if ek is not None:
                extras["effectKind"] = ek
            # Structured constructor args (full, untruncated) so consumers
            # read individual positional/keyword values without re-parsing the
            # (60-char-truncated) preview. Drives the architecture view's
            # per-layer param counts. Field-additive — no version bump (the
            # annotation/elseLine precedent). Star-args are skipped (rare in
            # layer constructors; still captured in the preview).
            pos_args: list[str] = []
            kw_args: list[dict] = []
            for a in node.value.args:
                if a.keyword is not None:
                    kw_args.append({"name": a.keyword.value, "value": self._code(a.value).strip()})
                elif a.star == "":
                    pos_args.append(self._code(a.value).strip())
            if pos_args:
                extras["args"] = pos_args
            if kw_args:
                extras["kwargs"] = kw_args
        self._emit(node_id, "assignment", self._pos(node),
                   cst_node=node, **extras)
        assign_node = self.nodes[-1]
        # Register module-scope plain-name assignments for edge resolution
        if not self._parent_stack and "." not in name:
            self._defs[name] = node_id
        # Reference edge when the value is a call to a known function/class
        if isinstance(node.value, cst.Call):
            callee = self._func_name(node.value.func).split(".")[0]
            if callee in self._defs and self._defs[callee] != node_id:
                self.edges.append({"source": node_id, "target": self._defs[callee], "type": "reference"})
        # M-NEST: mint nodes for nested call-arg calls + stamp honesty fields.
        self._stamp_nests(node.value, node_id, assign_node)

    # ── visitors: annotated assignment ────────────────────────────────
    #
    # `x: int`, `x: int = 0`, dataclass fields, `self.x: T = …`. Emitted as
    # `assignment` nodes (same NodeType — no schema bump) with an extra
    # optional `annotation` field carrying the type-annotation source. The
    # declaration-only form (`uid: int`) has no value, so `preview` is the
    # empty string and `valueKind` is "other"; consumers key the `name :
    # annotation` render off the empty preview. Without this visitor a
    # dataclass body parses to zero child nodes and the class renders blank.

    def visit_AnnAssign(self, node: cst.AnnAssign) -> None:
        name = self._target_name(node.target)
        annotation = self._code(node.annotation.annotation)
        safe = name.replace(".", "_")
        node_id = self._make_id("assign", safe)
        extras: dict = {"name": name, "annotation": annotation}
        if node.value is not None:
            extras["valueKind"] = self._value_kind(node.value)
            extras["preview"] = self._code(node.value)[:PREVIEW_MAX]
            if isinstance(node.value, cst.Call):
                self._claim(node.value)
                call_target = self._func_name(node.value.func)
                extras["callTarget"] = call_target
                ek = self._classify_effect_kind(call_target)
                if ek is not None:
                    extras["effectKind"] = ek
        else:
            extras["valueKind"] = "other"
            extras["preview"] = ""
        self._emit(node_id, "assignment", self._pos(node), cst_node=node, **extras)
        if not self._parent_stack and "." not in name:
            self._defs[name] = node_id
        if node.value is not None and isinstance(node.value, cst.Call):
            callee = self._func_name(node.value.func).split(".")[0]
            if callee in self._defs and self._defs[callee] != node_id:
                self.edges.append({"source": node_id, "target": self._defs[callee], "type": "reference"})

    # ── visitors: augmented assignment ────────────────────────────────
    #
    # M-ORCH.3 drill finding (2026-09-07): `stored += insert_readings(batch)`
    # emitted NOTHING — libcst's AugAssign is its own node type, so the call
    # on its right-hand side was invisible to the linker and the thread
    # extractor. backfill_from_file's thread therefore never reached
    # storage.py, and the constraint scoped to storage.py never routed to
    # it: a hidden call in the exact class this arc exists to end. Emitted
    # as an `assignment` node (no schema bump) with the additive `augmented`
    # field carrying the operator ("+=") — the same callTarget / effectKind /
    # args / reference-edge / nest handling as visit_Assign, so the linker
    # and extractor see the call like any other. (The C++ builder already
    # treated `+=` as an assignment_expression.)

    def visit_AugAssign(self, node: cst.AugAssign) -> None:
        name = self._target_name(node.target)
        vkind = self._value_kind(node.value)
        preview = self._code(node.value)[:PREVIEW_MAX]
        safe = name.replace(".", "_")
        node_id = self._make_id("assign", safe)
        try:
            operator = self._code(node.operator).strip() or "+="
        except Exception:  # an operator libcst cannot render in isolation
            operator = "?="
        extras: dict = {"name": name, "valueKind": vkind, "preview": preview, "augmented": operator}
        if isinstance(node.value, cst.Call):
            self._claim(node.value)
            call_target = self._func_name(node.value.func)
            extras["callTarget"] = call_target
            ek = self._classify_effect_kind(call_target)
            if ek is not None:
                extras["effectKind"] = ek
            pos_args: list[str] = []
            kw_args: list[dict] = []
            for a in node.value.args:
                if a.keyword is not None:
                    kw_args.append({"name": a.keyword.value, "value": self._code(a.value).strip()})
                elif a.star == "":
                    pos_args.append(self._code(a.value).strip())
            if pos_args:
                extras["args"] = pos_args
            if kw_args:
                extras["kwargs"] = kw_args
        self._emit(node_id, "assignment", self._pos(node), cst_node=node, **extras)
        assign_node = self.nodes[-1]
        # An augmented assignment never DEFINES a name (the target already
        # exists), so it is not registered in _defs — only the edge.
        if isinstance(node.value, cst.Call):
            callee = self._func_name(node.value.func).split(".")[0]
            if callee in self._defs and self._defs[callee] != node_id:
                self.edges.append({"source": node_id, "target": self._defs[callee], "type": "reference"})
        self._stamp_nests(node.value, node_id, assign_node)

    # ── visitors: function def ────────────────────────────────────────

    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
        # M-SWEEP W2 — DEF-TIME calls parent OUTSIDE the function.
        #
        # A decorator expression and a parameter default are evaluated when
        # the `def` is EXECUTED — at import — not when the function is
        # called. The generic sweep would reach them after `fn_id` is pushed
        # and file them inside the function body, and that is not a cosmetic
        # difference: `import_time_offenses` skips anything inside a
        # function, and the entry function's subtree never reaches an
        # UNCALLED helper. Measured: `def helper(x=requests.post(...))` on a
        # helper nobody calls came back pure=True with the node sitting at
        # `module/helper.fn/requests_post.call`. The node existed and was
        # filed where nothing would look for it.
        #
        # Emitting them here, before the push, puts them at the enclosing
        # scope — which is where they actually run, and is exactly the
        # predicate import_time_offenses tests.
        for deco in node.decorators:
            for call in self._outermost_calls(deco.decorator):
                self._emit_expr_call(call, node)
        for group in (node.params.posonly_params, node.params.params, node.params.kwonly_params):
            for prm in group:
                if prm.default is not None:
                    for call in self._outermost_calls(prm.default):
                        self._emit_expr_call(call, node)
        fn_name = node.name.value
        fn_id = self._make_id("fn", fn_name)
        params = [self._param_str(p) for p in node.params.params]
        doc = self._docstring(node.body)
        pos = self._pos(node)
        # IR 1.2 (M8.2): capture decorator source text. Used by
        # discover_entry_points.py for Flask/FastAPI route detection
        # (decorator-name string match per PLAN-v2.md §1.2). M9 keys
        # icon variants on this field. Empty list when bare.
        decorators = [self._code(d.decorator) for d in node.decorators]
        # IR 1.3 (M9.1): capture async-ness for the M9 icon system
        # (`Function` + `Loader2` overlay variant). libcst exposes
        # `node.asynchronous` as None for sync defs, an Asynchronous
        # node for `async def`. Always emitted so consumers don't have
        # to disambiguate "missing key" from "false".
        is_async = node.asynchronous is not None
        # §5.5 (field-additive, no version bump — like `annotation`):
        # capture the return-type annotation source text (the expression
        # after `->`), or None when unannotated. Enables one-hop
        # return-type inference in cross_file_link.py: a receiver bound
        # from `def _get_conn() -> sqlite3.Connection:` resolves
        # `conn.execute` to honest-external `sqlite3.Connection.execute`
        # instead of stopping at honest `dynamic`.
        returns = (
            self._code(node.returns.annotation)
            if node.returns is not None
            else None
        )
        # M-CONTRACT (2026-09-07, field-additive, no version bump — the
        # `returns` precedent): {name → annotation text} for every ANNOTATED
        # parameter, omitted when none is. `params` stays the `name` /
        # `name=default` list every consumer keys on; the thread contract
        # renders `name: type` from this map so a Python thread's "data in"
        # reads like a TS/C++ one's (they carry the type inside `params`).
        param_types = {
            p.name.value: self._code(p.annotation.annotation)
            for p in node.params.params
            if p.annotation is not None
        }
        fn_extras = {}
        if param_types:
            fn_extras["paramTypes"] = param_types
        # M-CONTRACT.6 (2026-09-08, field-additive, no version bump): where a
        # DECORATED def really starts. PositionProvider's span (`line`) begins
        # at `def`, but code_for_node — and the node replace_node REPLACES —
        # includes the decorators. Line-slicing readers (get_node_source, the
        # node editor) start here, so what a caller reads is exactly what a
        # whole-node replace writes back; before this, a worker that read a
        # Flask route and wrote it back silently lost its @route.
        if node.decorators:
            fn_extras["decoratorLine"] = self.get_metadata(
                meta.PositionProvider, node.decorators[0]
            ).start.line
        self._emit(fn_id, "function_def", pos, cst_node=node,
                   name=fn_name, params=params, docstring=doc,
                   decorators=decorators, isAsync=is_async, returns=returns,
                   **fn_extras)
        self.symbol_index.append({
            "sym": f"function:{fn_name}",
            "kind": "function",
            "name": fn_name,
            "scope": self._parent_id() or "module",
            "loc": pos,
            "signature": f"def {fn_name}({', '.join(params)})",
            "docstring": doc,
            "source": self._code(node),
        })
        # Register module-scope and class-level functions for call resolution
        if len(self._parent_stack) == 0:
            self._defs[fn_name] = fn_id
        self._parent_stack.append(fn_id)

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self._parent_stack.pop()

    # ── visitors: class def ───────────────────────────────────────────

    def visit_ClassDef(self, node: cst.ClassDef) -> None:
        cls_name = node.name.value
        cls_id = self._make_id("class", cls_name)
        bases = [self._code(a.value) for a in node.bases]
        pos = self._pos(node)
        # IR 1.2 (M8.2): capture decorator source text. Used by
        # M9's icon system (e.g. @dataclass → FileText). Empty when bare.
        decorators = [self._code(d.decorator) for d in node.decorators]
        # M-FS6 (field-additive, no version bump — mirrors function_def):
        # class docstring, so entry-point rows can summarize class entries
        # the way they already summarize functions.
        doc = self._docstring(node.body)
        cls_extras = {}
        # M-CONTRACT.6 — see function_def: a decorated class (@dataclass)
        # starts at its first decorator for every line-slicing reader.
        if node.decorators:
            cls_extras["decoratorLine"] = self.get_metadata(
                meta.PositionProvider, node.decorators[0]
            ).start.line
        self._emit(cls_id, "class_def", pos, cst_node=node,
                   name=cls_name, bases=bases, decorators=decorators,
                   docstring=doc, **cls_extras)
        self.symbol_index.append({
            "sym": f"class:{cls_name}",
            "kind": "class",
            "name": cls_name,
            "scope": "module",
            "loc": pos,
            "bases": bases,
            "docstring": doc,
            "source": self._code(node),
        })
        if not self._parent_stack:
            self._defs[cls_name] = cls_id
        # Inheritance reference edges to already-defined base classes
        for base in bases:
            bare = base.split(".")[0]
            if bare in self._defs:
                self.edges.append({"source": cls_id, "target": self._defs[bare], "type": "reference"})
        self._parent_stack.append(cls_id)

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self._parent_stack.pop()

    # ── visitors: for loop ────────────────────────────────────────────

    def visit_For(self, node: cst.For) -> None:
        # The ITERABLE is evaluated once, before the body — `for r in
        # fetch_all():` calls fetch_all once, not per iteration. So it is
        # emitted BEFORE the for node is pushed, parenting to the enclosing
        # scope. (Contrast a `while` test, which re-evaluates every iteration
        # and therefore belongs inside the loop.)
        for call in self._once_calls(node.iter):
            self._emit_expr_call(call, node)
        self._defer_comprehensions(node.iter)
        target = node.target.value if isinstance(node.target, cst.Name) else self._code(node.target)
        iter_text = self._code(node.iter)
        for_id = self._make_id("for", "")
        pos = self._pos(node)
        self._emit(for_id, "for_loop", pos, cst_node=node, target=target, iterName=iter_text)
        # Data edge: iterable variable → this for loop
        if isinstance(node.iter, cst.Name) and node.iter.value in self._defs:
            self.edges.append({"source": self._defs[node.iter.value], "target": for_id, "type": "data"})
        self._parent_stack.append(for_id)

    def leave_For(self, node: cst.For) -> None:
        self._parent_stack.pop()

    # ── visitors: if stmt ─────────────────────────────────────────────

    def visit_If(self, node: cst.If) -> None:
        # Before the if_stmt is emitted and pushed: the test runs in the
        # ENCLOSING flow, not in either arm.
        for call in self._once_calls(node.test):
            self._emit_expr_call(call, node)
        self._defer_comprehensions(node.test)
        condition = self._code(node.test)
        has_else = node.orelse is not None
        if_id = self._make_id("if", "")
        pos = self._pos(node)
        extras: dict = {"condition": condition, "hasElse": has_else}
        # M17.3 — source-position disambiguation for the if_then / if_else
        # split (PLAN-v3-revised §E.4). When the if has any trailing arm we
        # record `elseLine` = the start line of that arm, so the thread
        # extractor can bucket a call site into the then-arm (line < elseLine)
        # or the else-arm (line >= elseLine).
        #
        # This covers `elif` as well as plain `else`: an `elif` is a nested
        # If sitting in this If's `orelse`, so its start line marks the
        # boundary. A call reached through the elif lands in the outer if's
        # if_else arm (correct — `elif` IS the else path), and the elif's own
        # if_stmt node nests inside that else container. Without this, the
        # elif's subtree would default to the outer if's then-arm and the
        # `IF` region would wrongly enclose code that only runs in the else
        # path.
        if node.orelse is not None:
            extras["elseLine"] = self._pos(node.orelse)["line"]
        self._emit(if_id, "if_stmt", pos, cst_node=node, **extras)
        self._parent_stack.append(if_id)

    def leave_If(self, node: cst.If) -> None:
        self._parent_stack.pop()

    # ── visitors: comprehensions (M-COMP) ─────────────────────────────
    #
    # A COMPREHENSION IS A LOOP. `[requests.get(u) for u in urls]` performs
    # exactly the N round trips the spelled-out for-loop performs, and W1's
    # expression sweep already emits the call node for it — so the effect
    # floor sees it. What nothing saw was the REPETITION: round-trip
    # detection (thread_contract.ts) walks the thread for a loop CONTAINER,
    # and a comprehension had none. The N+1 verdict therefore depended on
    # which spelling the author chose, which is the class of inconsistency
    # this project refuses everywhere else.
    #
    # ALL FOUR FORMS, generator expressions included. A genexp is lazy, so
    # its repetition is only real once something consumes it — but W1
    # already emits the element's call node regardless, so excluding the
    # container would make the round-trip verdict depend on brackets while
    # the effect verdict did not. NAMED LIMIT: whether a genexp is consumed
    # is not tracked. `sum(fetch(u) for u in urls)` and a genexp assigned
    # and dropped are indistinguishable here, and both report the loop.
    #
    # THE OUTERMOST ITERABLE RUNS ONCE. `[r for r in requests.get(u).json()]`
    # is ONE request, not N — so its calls are emitted BEFORE the push and
    # parent OUTSIDE the container. That is exactly the rule visit_For
    # applies to `for x in fetch_all():`, and the contrast with a `while`
    # test (re-evaluated per iteration, therefore inside) is the same
    # contrast. Everything else repeats and parents INSIDE: the element,
    # every `if` clause, and every INNER `for`'s iterable.
    def _visit_comprehension(self, node) -> None:
        # ONE CONTAINER PER `for` CLAUSE. A comprehension may carry several,
        # and they are NESTED LOOPS — `[f(x) for g in groups for x in g]`
        # runs f exactly as often as the spelled-out
        #
        #     for g in groups:
        #         for x in g:
        #             f(x)
        #
        # Emitting one container for the whole comprehension reported that
        # as a single loop, so an N*M fan-out read as N. libcst hands the
        # clauses back as a chain (`for_in` -> `inner_for_in`) in OUTERMOST
        # -FIRST order, which is the nesting; walking it is the whole fix.
        #
        # SOURCE ORDER IS NOT EVALUATION ORDER, and this is where that bites.
        # A comprehension writes its element FIRST and executes it LAST, and
        # libcst visits `elt` before `for_in` to match the source. Pushing
        # the entire clause chain here — before any child is visited — is
        # what normalises the two: by the time traversal reaches the element,
        # every loop it runs under is already on the stack.
        outer = self._comp_outer_parent.pop(id(node), _NO_OVERRIDE)
        deferred = outer is not _NO_OVERRIDE
        if deferred:
            self._parent_stack.append(outer)

        kind = COMPREHENSION_KINDS[type(node)]
        pos = self._pos(node)
        pushed = 0
        clause = node.for_in
        while clause is not None:
            # EACH CLAUSE'S ITERABLE RUNS OUTSIDE ITS OWN CONTAINER — the
            # first clause's once in the enclosing flow, a later clause's
            # once per item of the clause before it. Emitted before the push
            # so it parents one level up, the same rule visit_For applies to
            # `for x in fetch_all():`.
            for call in self._once_calls(clause.iter):
                self._emit_expr_call(call, node)
            self._defer_comprehensions(clause.iter)

            comp_id = self._make_id("comp", "")
            self._emit(comp_id, "comprehension", pos, cst_node=node,
                       compKind=kind,
                       target=self._code(clause.target),
                       iterName=self._code(clause.iter))
            self._parent_stack.append(comp_id)
            pushed += 1

            # THIS clause's `if`s run per item of THIS clause, so they belong
            # inside it and — the part that needs saying — NOT inside the
            # next clause's container. Traversal reaches them only after the
            # whole chain is pushed, so they are emitted and claimed here.
            for cond in clause.ifs:
                for call in self._once_calls(cond.test):
                    self._emit_expr_call(call, node)
                self._defer_comprehensions(cond.test)

            clause = clause.inner_for_in

        if deferred:
            # The recorded outer parent has done its job: every container is
            # on the stack above it. Remove it so leave has one thing to
            # unwind, not two kinds of thing.
            del self._parent_stack[-(pushed + 1)]

        self._uses_containers = True
        # A COMPREHENSION IS A NEW EVALUATION SCOPE, so nesting depth
        # restarts. Without this, `list(post() for _ in xs)` leaves the
        # sweep at depth 2 inside `list`, and the element's call is emitted
        # by nobody — the generic sweep fires at depth 1 only, and the
        # arg-nest extractor (correctly) no longer descends here.
        self._comp_call_depth.append(self._call_depth)
        self._call_depth = 0
        self._comp_pushed.append(pushed)

    def _leave_comprehension(self, node) -> None:
        for _ in range(self._comp_pushed.pop()):
            self._parent_stack.pop()
        self._call_depth = self._comp_call_depth.pop()

    visit_ListComp = _visit_comprehension
    leave_ListComp = _leave_comprehension
    visit_SetComp = _visit_comprehension
    leave_SetComp = _leave_comprehension
    visit_DictComp = _visit_comprehension
    leave_DictComp = _leave_comprehension
    visit_GeneratorExp = _visit_comprehension
    leave_GeneratorExp = _leave_comprehension

    # ── visitors: while loop (M17.2) ──────────────────────────────────

    def visit_While(self, node: cst.While) -> None:
        condition = self._code(node.test)
        while_id = self._make_id("while", "")
        pos = self._pos(node)
        self._emit(while_id, "while_loop", pos, cst_node=node, condition=condition)
        self._uses_containers = True
        self._parent_stack.append(while_id)
        # AFTER the push: a while test is re-evaluated every iteration, so a
        # round trip in it is a round trip INSIDE the loop.
        for call in self._once_calls(node.test):
            self._emit_expr_call(call, node)

    def leave_While(self, node: cst.While) -> None:
        self._parent_stack.pop()

    # ── visitors: with (PLAN-v7 6a — the with-item floor fix) ─────────
    #
    # A with-item call previously emitted NOTHING: `with open(p) as f:`
    # produced zero nodes, so scan_effects.py judged the path pure while
    # it opened a file — a hole in the effect floor (found during the
    # Stage-5 orchestrator gate; also blinds SM3 run-to-node consent).
    #
    # Emission mirrors the with-item's runtime semantics, reusing
    # existing node types (field-additive, no schema bump):
    #   * `with open(p) as f:`  → an `assignment` node (name=f,
    #     valueKind="call", callTarget, effectKind) — exactly the shape
    #     of `f = open(p)`, so the floor's effect scan, call-site
    #     collection AND local-binding honesty (`f.read()` later is
    #     dynamic, not unresolved) all work unchanged.
    #   * `with lock():` (no as-binding, or a non-Name binding) → a
    #     bare `call` node, the visit_Expr shape.
    # Non-call items (`with lock:`) emit nothing — no call, no effect.
    #
    # NOT in scope here: a `with` container node (the block's body still
    # parents to the enclosing scope, like before). Promoting `with` to
    # a rendered container is a separate enum-additive IR bump with its
    # own thread-renderer work — named follow-up in PLAN-v7.

    # M-GRAMMAR (2026-09-10) — CONDITION CALLS. The SAME hole the with-item
    # fix above closed, in a second expression position nobody had walked:
    #
    #     if requests.post(url, json={}).ok:   ->  ZERO nodes, no effectKind
    #     r = requests.post(url, json={})      ->  gated, as it should be
    #
    # scan_effects.py re-derives its verdict from the IR, so no node meant no
    # offense: the first form was judged `pure=True` and would have RUN
    # WITHOUT CONSENT. Measured, not reasoned — /tmp probe against
    # scan_effects itself, both forms side by side.
    #
    # Found while building the constraint grammar: `calls-through notify via
    # should_notify` reported a false VIOLATION on compliant code, because
    # `if not should_notify(...)` was invisible. The false violation was the
    # symptom; the floor hole was the disease.
    #
    # Emission mirrors visit_With's no-asname branch exactly (the `call`
    # shape visit_Expr uses), so the effect scan, call-site collection and
    # reference edges all work unchanged. OUTERMOST calls only, with nests
    # stamped — `f(g())` is one node with g recorded on it, which is how
    # every other call site in this file is already shaped.
    #
    # WHERE the node parents differs by construct, and it is not cosmetic:
    #   * an `if` test is evaluated ONCE, in the enclosing flow, before
    #     either arm — so it parents OUTSIDE the if_stmt. Parenting it inside
    #     would bucket it into the then-arm, which is a lie about a condition
    #     that runs whichever arm is taken.
    #   * a `while` test is re-evaluated EVERY iteration — so it parents
    #     INSIDE the while_loop, which is what makes a round trip in a loop
    #     condition visible to the contract's round-trip detection.

    def _outermost_calls(self, expr) -> list:
        """Calls in an expression, not descending into a call's own subtree."""
        found: list = []

        def walk(n) -> None:
            if isinstance(n, cst.Call):
                found.append(n)
                return
            for child in n.children:
                walk(child)

        walk(expr)
        return found

    def _top_comprehensions(self, expr) -> list:
        """Outermost comprehensions in an expression, not descending into one
        (an inner comprehension is its own container's business)."""
        found: list = []

        def walk(n) -> None:
            if isinstance(n, COMPREHENSION_TYPES):
                found.append(n)
                return
            for child in n.children:
                walk(child)

        walk(expr)
        return found

    def _defer_comprehensions(self, expr) -> None:
        """Record the enclosing-scope parent for every comprehension in an
        expression that runs BEFORE the container about to be pushed.

        `for x in [f(y) for y in ys]:` evaluates the list ONCE, before the
        loop starts; `if any(f(y) for y in ys):` evaluates the generator in
        whichever flow reaches the test, not inside either arm. Calls in
        those positions are already emitted before the push. A comprehension
        cannot be, because its CONTENTS are only reached by traversal — so
        the container is emitted at its natural moment, against the parent
        recorded here.
        """
        parent = self._parent_id()
        for comp in self._top_comprehensions(expr):
            self._comp_outer_parent[id(comp)] = parent

    def _once_calls(self, expr) -> list:
        """`_outermost_calls`, but ALSO stopping at a nested comprehension.

        Used by the four constructs that emit an expression's calls BEFORE
        pushing their own container: an `if`/`while` test, a `for` iterable,
        and a comprehension's outermost iterable. Each of those expressions
        runs in the enclosing flow, so its calls parent outside the
        container being built.

        A comprehension written INSIDE such an expression is the exception.
        `for x in [f(y) for y in ys]` runs `f` once per y, inside the inner
        comprehension's own container — not once in the enclosing scope.
        Descending into it would claim `f` at the wrong level, and the
        traversal that later reaches the inner container would then skip it
        as already-emitted: a node in the WRONG PLACE, which is worse than
        no node, because it looks handled.
        """
        found: list = []

        def walk(n) -> None:
            if isinstance(n, cst.Call):
                found.append(n)
                return
            if isinstance(n, COMPREHENSION_TYPES):
                return  # its own container owns everything inside it
            for child in n.children:
                walk(child)

        walk(expr)
        return found

    def _emit_expr_call(self, call, owner) -> None:
        """One `call` node for a call written in an EXPRESSION position.

        The visit_Expr shape, so the effect scan, call-site collection and
        reference edges all read it unchanged. Used by the generic sweep and
        by the two constructs that must emit BEFORE their container is
        pushed (see visit_If / visit_For).
        """
        self._claim(call)
        func_name = self._func_name(call.func)
        args = [self._code(a.value) for a in call.args]
        is_effect = (
            func_name in {"print", "write", "flush", "close"}
            or func_name.endswith(".write")
            or func_name.endswith(".print")
        )
        safe_name = func_name.replace(".", "_").replace("()", "")
        node_id = self._make_id("call", safe_name)
        extras: dict = {"funcName": func_name, "args": args, "isEffect": is_effect}
        ek = self._classify_effect_kind(func_name)
        if ek is not None:
            extras["effectKind"] = ek
        self._emit(node_id, "call", self._pos(call), cst_node=owner, **extras)
        emitted = self.nodes[-1]
        base = func_name.split(".")[0]
        if base in self._defs:
            self.edges.append({"source": node_id, "target": self._defs[base], "type": "reference"})
        self._stamp_nests(call, node_id, emitted)

    def visit_With(self, node: cst.With) -> None:
        for item in node.items:
            if not isinstance(item.item, cst.Call):
                continue
            call = item.item
            self._claim(call)
            func_name = self._func_name(call.func)
            asname: Optional[str] = None
            if item.asname is not None and isinstance(item.asname.name, cst.Name):
                asname = item.asname.name.value
            if asname:
                node_id = self._make_id("assign", asname.replace(".", "_"))
                extras: dict = {
                    "name": asname,
                    "valueKind": "call",
                    "preview": self._code(call)[:PREVIEW_MAX],
                    "callTarget": func_name,
                }
                ek = self._classify_effect_kind(func_name)
                if ek is not None:
                    extras["effectKind"] = ek
                self._emit(node_id, "assignment", self._pos(call), cst_node=node, **extras)
                emitted = self.nodes[-1]
                if not self._parent_stack and "." not in asname:
                    self._defs[asname] = node_id
                callee = func_name.split(".")[0]
                if callee in self._defs and self._defs[callee] != node_id:
                    self.edges.append({"source": node_id, "target": self._defs[callee], "type": "reference"})
            else:
                args = [self._code(a.value) for a in call.args]
                is_effect = (
                    func_name in {"print", "write", "flush", "close"}
                    or func_name.endswith(".write")
                    or func_name.endswith(".print")
                )
                safe_name = func_name.replace(".", "_").replace("()", "")
                node_id = self._make_id("call", safe_name)
                extras = {"funcName": func_name, "args": args, "isEffect": is_effect}
                ek = self._classify_effect_kind(func_name)
                if ek is not None:
                    extras["effectKind"] = ek
                self._emit(node_id, "call", self._pos(call), cst_node=node, **extras)
                emitted = self.nodes[-1]
                base = func_name.split(".")[0]
                if base in self._defs:
                    self.edges.append({"source": node_id, "target": self._defs[base], "type": "reference"})
            self._stamp_nests(call, node_id, emitted)

    # ── visitors: try / except / finally (M17.2) ──────────────────────
    #
    # The three arms are emitted as **siblings** of try_stmt — all four
    # nodes share the same parentId (the enclosing scope). Body statements
    # of each arm parent at that arm's node. The "this except belongs to
    # that try" relationship is positional (source-order proximity),
    # mirroring libcst's own structural model where Try.handlers is a
    # sibling list to Try.body.
    #
    # Stack discipline:
    #   visit_Try:           push try_id            → [..., enc, try]
    #   try.body children    parent = try_id
    #   visit_ExceptHandler: pop try, emit handler at enc, re-push try, push handler
    #                                                → [..., enc, try, handler]
    #   handler children     parent = handler_id
    #   leave_ExceptHandler: pop handler            → [..., enc, try]
    #   visit_Finally:       pop try, emit finally at enc, re-push try, push finally
    #                                                → [..., enc, try, finally]
    #   finally children     parent = finally_id
    #   leave_Finally:       pop finally            → [..., enc, try]
    #   leave_Try:           pop try                → [..., enc]
    #
    # try.orelse (the rare `try: … except: … else:` arm) and except-as-name
    # bindings are not promoted to their own nodes — out of M17.2 scope
    # per PLAN-v3-revised §E.7.

    def visit_Try(self, node: cst.Try) -> None:
        try_id = self._make_id("try", "")
        pos = self._pos(node)
        self._emit(try_id, "try_stmt", pos, cst_node=node)
        self._uses_containers = True
        self._parent_stack.append(try_id)

    def leave_Try(self, node: cst.Try) -> None:
        self._parent_stack.pop()

    def visit_ExceptHandler(self, node: cst.ExceptHandler) -> None:
        # Pop the try_id (or previous arm's id) so the handler emits at
        # the enclosing scope, not under the try.
        try_id = self._parent_stack.pop()
        except_type = self._code(node.type) if node.type is not None else None
        handler_id = self._make_id("except", "")
        pos = self._pos(node)
        self._emit(handler_id, "except_handler", pos, cst_node=node, exceptType=except_type)
        self._uses_containers = True
        # Restore try_id under handler_id so leave_Try still finds it on top.
        self._parent_stack.append(try_id)
        self._parent_stack.append(handler_id)

    def leave_ExceptHandler(self, node: cst.ExceptHandler) -> None:
        self._parent_stack.pop()

    def visit_Finally(self, node: cst.Finally) -> None:
        try_id = self._parent_stack.pop()
        finally_id = self._make_id("finally", "")
        pos = self._pos(node)
        self._emit(finally_id, "finally_block", pos, cst_node=node)
        self._uses_containers = True
        self._parent_stack.append(try_id)
        self._parent_stack.append(finally_id)

    def leave_Finally(self, node: cst.Finally) -> None:
        self._parent_stack.pop()

    # ── visitors: return / raise ──────────────────────────────────────

    def _emit_local_ref(self, source_id: str, call_target: Optional[str]) -> None:
        """Emit a same-file `reference` edge from `source_id` to the
        module-scope function/class named by `call_target`'s head, if one
        is known. No-op when the target is absent or unknown."""
        if not call_target:
            return
        base = call_target.split(".")[0]
        if base in self._defs and self._defs[base] != source_id:
            self.edges.append({"source": source_id, "target": self._defs[base], "type": "reference"})

    def visit_Return(self, node: cst.Return) -> None:
        value_text = self._code(node.value)[:PREVIEW_MAX] if node.value else None
        ret_id = self._make_id("return", "")
        extras: dict = {"value": value_text}
        # M-NEST: surface a return-VALUE call (`return self.fc(x)`). Without a
        # callTarget the architecture forwardSeq dropped this layer entirely.
        if node.value is not None and isinstance(node.value, cst.Call):
            self._claim(node.value)
            ct = self._func_name(node.value.func)
            extras["callTarget"] = ct
            ek = self._classify_effect_kind(ct)
            if ek is not None:
                extras["effectKind"] = ek
        self._emit(ret_id, "return_stmt", self._pos(node), cst_node=node, **extras)
        # Same-file reference edge, mirroring visit_Assign / visit_Expr.
        # Without it `return Foo()` had no edge AND missed the extractor's
        # fallback (resolve_same_file matches function_def only), so a
        # same-file class instantiation painted an `unresolved` terminal
        # while the identical `f = Foo()` painted a step.
        self._emit_local_ref(ret_id, extras.get("callTarget"))
        if node.value is not None:
            self._stamp_nests(node.value, ret_id, self.nodes[-1])

    def visit_Raise(self, node: cst.Raise) -> None:
        # PREVIEW_MAX, not a bespoke 40: every other preview-bearing node
        # (assignment RHS, return value, call source) uses the shared cap, and
        # 40 chars cut a routine `raise ValueError(f"...")` mid-expression —
        # `ValueError(\n    f"length mismatch: {len(` — with nothing to show a
        # cut had happened. The view already wraps and clamps, so the honest
        # place to bound this is the same place as everything else.
        exc_text = self._code(node.exc)[:PREVIEW_MAX] if node.exc else None
        raise_id = self._make_id("raise", "")
        extras: dict = {"exc": exc_text}
        if node.exc is not None and isinstance(node.exc, cst.Call):
            self._claim(node.exc)
            ct = self._func_name(node.exc.func)
            extras["callTarget"] = ct
            ek = self._classify_effect_kind(ct)
            if ek is not None:
                extras["effectKind"] = ek
        self._emit(raise_id, "raise_stmt", self._pos(node), cst_node=node, **extras)
        # Same gap as visit_Return: `raise ProjectError(...)` on a locally
        # defined exception class had no reference edge.
        self._emit_local_ref(raise_id, extras.get("callTarget"))
        if node.exc is not None:
            self._stamp_nests(node.exc, raise_id, self.nodes[-1])

    # ── visitors: expression statements (bare calls) ──────────────────

    def visit_Expr(self, node: cst.Expr) -> None:
        if not isinstance(node.value, cst.Call):
            return
        call = node.value
        self._claim(call)
        func_name = self._func_name(call.func)
        args = [self._code(a.value) for a in call.args]
        is_effect = (
            func_name in {"print", "write", "flush", "close"}
            or func_name.endswith(".write")
            or func_name.endswith(".print")
        )
        # IR 1.3 (M9.1): classify external-effect kind for the icon system.
        effect_kind = self._classify_effect_kind(func_name)
        safe_name = func_name.replace(".", "_").replace("()", "")
        call_id = self._make_id("call", safe_name)
        extras = {"funcName": func_name, "args": args, "isEffect": is_effect}
        if effect_kind is not None:
            extras["effectKind"] = effect_kind
        self._emit(call_id, "call", self._pos(call), cst_node=node, **extras)
        call_node = self.nodes[-1]
        # Reference edge: call site → function/class definition
        base = func_name.split(".")[0]
        if base in self._defs:
            self.edges.append({"source": call_id, "target": self._defs[base], "type": "reference"})
        # M-NEST: a bare call's arguments may themselves nest calls.
        self._stamp_nests(call, call_id, call_node)


# ──────────────────────────────────────────────────────── main ──────

# Parser-emitted version. Files without v1.4 / v1.5 features keep this
# baseline; cross_file_link.py ratchets up for cross-file edges (v1.1)
# and viaLocal edges (v1.4); M17.2's container-emitting paths ratchet
# the per-file version up to IR_VERSION_CONTAINERS at emit time.
IR_VERSION = "1.3"
IR_VERSION_CONTAINERS = "1.5"


def parse_file(path: str, module_path: Optional[str] = None) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        source = f.read()
    module = cst.parse_module(source)
    wrapper = meta.MetadataWrapper(module)
    builder = GraphBuilder(module)
    wrapper.visit(builder)
    version = IR_VERSION_CONTAINERS if builder._uses_containers else IR_VERSION
    result: dict = {
        "version": version,
        "nodes": builder.nodes,
        "edges": builder.edges,
        "symbolIndex": builder.symbol_index,
    }
    if module_path is not None:
        result["modulePath"] = module_path
    return result


def _batch_worker(arg: tuple) -> tuple:
    """Pool worker: parse one file, returning a (path, ok, payload) triple.

    Module-level so multiprocessing can pickle it. Errors don't raise --
    they're returned alongside the path so the parent can collate.
    """
    path, module_path = arg
    try:
        return (path, True, parse_file(path, module_path=module_path))
    except Exception as e:  # noqa: BLE001 -- mirror server.ts per-file behaviour
        return (path, False, str(e))


def _run_batch(workers: int) -> None:
    """Parse every (path, module_path) pair on stdin.

    On Linux this forks workers from the current process, so libcst's
    import cost is paid once in the parent and inherited by every
    worker -- not paid per file the way 29 separate execFile spawns did.
    `workers=1` keeps everything in this process (the M6-wave-3b baseline)
    so a deterministic fallback exists if multiprocessing misbehaves.
    """
    items: list = []
    for raw in sys.stdin:
        line = raw.rstrip("\n")
        if not line:
            continue
        if "\t" in line:
            path, module_path = line.split("\t", 1)
            module_path = module_path or None
        else:
            path, module_path = line, None
        items.append((path, module_path))

    files: dict = {}
    errors: dict = {}
    if workers <= 1 or len(items) <= 1:
        results = (_batch_worker(it) for it in items)
    else:
        # Lazy import keeps `python3 parse_cst.py foo.py` (single-file
        # mode) from paying the multiprocessing import cost.
        import multiprocessing as mp
        ctx = mp.get_context("fork")
        with ctx.Pool(processes=min(workers, len(items))) as pool:
            results = pool.map(_batch_worker, items)
    for path, ok, payload in results:
        if ok:
            files[path] = payload
        else:
            errors[path] = payload
    json.dump({"files": files, "errors": errors}, sys.stdout)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="VibeGraph CST parser.")
    ap.add_argument("file", nargs="?", help="Path to Python source file (single-file mode).")
    ap.add_argument("--module-path", default=None,
                    help="Dotted module path relative to project root "
                         "(supplied by server.ts in project mode).")
    ap.add_argument("--batch", action="store_true",
                    help="Read newline-delimited '<path>\\t<modulePath>' "
                         "pairs from stdin; emit one combined JSON.")
    ap.add_argument("--workers", type=int, default=0,
                    help="Batch-mode parallelism. 0 (default) = os.cpu_count(); "
                         "1 = parse in-process (deterministic fallback).")
    args = ap.parse_args()
    if args.batch:
        if args.file is not None:
            ap.error("--batch reads file list from stdin; do not pass a positional file.")
        import os as _os
        nworkers = args.workers if args.workers > 0 else (_os.cpu_count() or 1)
        _run_batch(nworkers)
    else:
        if args.file is None:
            ap.error("file argument required (or pass --batch).")
        result = parse_file(args.file, module_path=args.module_path)
        print(json.dumps(result, indent=2))
