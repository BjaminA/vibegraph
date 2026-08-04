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

    def _expr_has_nested_call(self, value: cst.BaseExpression) -> bool:
        """True iff `value` hides a call the outer node would otherwise mask:
        any cst.Call beyond an outermost single call. Covers every nest form."""
        all_calls = m.findall(value, m.Call())
        if not all_calls:
            return False
        # When the value is itself a single outer call, exclude it from the
        # nested set; otherwise (list/comp/binop/…) any contained call is nested.
        return len(all_calls) > 1 if isinstance(value, cst.Call) else True

    def _emit_nested_call(self, call: cst.Call, depth: int) -> int:
        """Emit one nested `call` node (parent = current _parent_id, so _emit
        wires the contains edge outer→inner) and recurse into its call-valued
        args. Returns total nodes minted including this one."""
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
        finally:
            self._parent_stack.pop()
        return minted

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

    # ── visitors: function def ────────────────────────────────────────

    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
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
        self._emit(fn_id, "function_def", pos, cst_node=node,
                   name=fn_name, params=params, docstring=doc,
                   decorators=decorators, isAsync=is_async, returns=returns)
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
        self._emit(cls_id, "class_def", pos, cst_node=node,
                   name=cls_name, bases=bases, decorators=decorators,
                   docstring=doc)
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

    # ── visitors: while loop (M17.2) ──────────────────────────────────

    def visit_While(self, node: cst.While) -> None:
        condition = self._code(node.test)
        while_id = self._make_id("while", "")
        pos = self._pos(node)
        self._emit(while_id, "while_loop", pos, cst_node=node, condition=condition)
        self._uses_containers = True
        self._parent_stack.append(while_id)

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

    def visit_With(self, node: cst.With) -> None:
        for item in node.items:
            if not isinstance(item.item, cst.Call):
                continue
            call = item.item
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
        exc_text = self._code(node.exc)[:40] if node.exc else None
        raise_id = self._make_id("raise", "")
        extras: dict = {"exc": exc_text}
        if node.exc is not None and isinstance(node.exc, cst.Call):
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
