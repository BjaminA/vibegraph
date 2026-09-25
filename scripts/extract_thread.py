#!/usr/bin/env python3
"""
Thread extraction for VibeGraph thread view (M4b wave 2).

Pure JSON post-processor. Consumes the project IR map emitted by
cross_file_link.py (M4a) plus a seed function id, and emits a thread JSON
that the renderer (wave 3) draws as a force-directed graph rooted at the
seed.

Pipeline:
  stdin  : {"files": {filePath: IR, ...}}            -- the linked project IR
  argv   : --seed-file main.py --seed-id "module/compute_drag.fn"
  stdout : thread JSON (see schema below)

Static-only per PLAN.md S1.3. The extractor stops at:

  - external/library boundaries (callTarget contains '.', or is a known
    builtin) -- emitted as `kind: "external"` terminal nodes.
  - dynamic dispatch (callTarget is one of {getattr, setattr, hasattr,
    delattr}, OR a local variable invoked at runtime) -- emitted as
    `kind: "dynamic"` terminals. This is an HONEST property of the code:
    the target is genuinely resolved at runtime.
  - unresolved references (a bare callTarget that is NOT a local binding
    and that the same-file / cross-file linker could not resolve) --
    emitted as `kind: "unresolved"` terminals. This is a RESOLUTION GAP,
    not a runtime property: we could not statically find the target
    (often a missing import or a linker miss). Kept distinct from
    `dynamic` so the thread view never flattens "runtime-determined" and
    "couldn't find it" into one marker (R3).
  - cycles (function visited earlier in the trace) -- re-linked rather
    than re-expanded; no infinite recursion.

Calls that sit inside an `if_stmt` with `hasElse: true` are marked
`kind: "conditional"` on the edge so the renderer can dash them. We treat
hasElse as the "both arms non-trivial" proxy (PLAN.md S1.3) -- the
parser collapses both arms into the same structural-path prefix, so
finer-grained branch tracking isn't available without a parser change.

Output schema (thread JSON v1.0):

  {
    "version": "1.0",
    "seed": {"file": str, "irNodeId": str, "qualifiedName": str},
    "nodes": [
      {
        "id": str,                  # qualified name (file_module:symbol)
                                    # or a synthetic "<seed>:return" / "external:..." id
        "kind": "seed" | "step" | "external" | "dynamic" | "unresolved"
                | "return" | "container",
        "label": str,
        "file": str | null,         # null for external/dynamic/unresolved terminals
        "irNodeId": str | null,     # null for terminals
        "preview": str | null,      # e.g. literal return-value, or callTarget for terminals
        # container-only:
        "containerKind": "try" | "except" | "finally" | "while"
                         | "for" | "if_then" | "if_else" | "comprehension",
      }
    ],
    "edges": [
      {
        "from": str,                # thread node id
        "to": str,
        "kind": "direct" | "conditional" | "contains",
        "irSource": str | null,     # the call-site IR node id in the FROM file
      }
    ]
  }

M17.2 / M17.3: calls that sit inside a control-flow container (try /
except / finally / while / for / if) get an additional `contains` edge
from a synthetic "container" thread node to the call's thread node.
Nested containers chain: `outer → inner` is also a `contains` edge. The
existing direct / conditional edges from the function to its call sites
are preserved — the renderer overlays the contains-graph on top to draw
bounded regions. M17.3 added for_loop + if_stmt promotion; an if_stmt is
split into if_then / if_else arms using the parser's `elseLine`
source-position marker (§E.4), so a call in the else branch lands in a
distinct container from one in the then branch.

Re-emission discipline: nodes and edges are ordered deterministically by
first-visit (DFS pre-order); within a function, by call-site IR id sorted
lexicographically. This keeps the snapshot test stable across runs.
"""

import argparse
import os
import json
import re
import sys
from typing import Dict, List, Optional, Tuple

# ─────────────────────────────────────────── classification tables ───

# Python builtins whose presence as a bare callTarget means "external"
# (a known stdlib boundary) rather than "dynamic". Keep this list short
# and explicit -- anything else falls through to the dynamic classifier.
KNOWN_BUILTINS = frozenset({
    "print", "len", "range", "enumerate", "zip", "sorted", "reversed",
    "abs", "min", "max", "sum", "any", "all", "map", "filter",
    "int", "float", "str", "bool", "list", "dict", "set", "tuple",
    "repr", "type", "isinstance", "issubclass", "id", "hash",
    "open", "input", "iter", "next",
    # PLAN-v7 6d (pre-flight finding): builtin EXCEPTION constructors.
    # `raise ValueError(...)` in a check classified "unresolved" and
    # forced a needless consent gate -- constructing a builtin exception
    # is pure; the raise itself is control flow the floor already models.
    "Exception", "ValueError", "TypeError", "KeyError", "IndexError",
    "AttributeError", "RuntimeError", "NotImplementedError",
    "AssertionError", "StopIteration", "LookupError", "ArithmeticError",
    "ZeroDivisionError", "OSError", "IOError",
})

# Dynamic-dispatch builtins -- callTarget == one of these means "stops
# here, runtime resolution required".
DYNAMIC_BUILTINS = frozenset({"getattr", "setattr", "hasattr", "delattr"})

# M-LANG2b — shell builtins a NON-PYTHON (bash) frontend emits as calls
# but which are shell-internal: a known boundary ('external'), never a
# resolution gap. Counterpart of NEUTRAL_BUILTINS in
# scripts/frontends/bash/tables.mjs — keep them in sync (same documented
# duplication class as scan_effects.py's tables; consolidation trigger =
# a third consumer, per the CLAUDE.md abstraction rule).
NONPYTHON_NEUTRAL_BUILTINS = frozenset({
    "read", "test", "[", "[[", "trap", "exec", "command",
    "type", "hash", "let", "local", "declare", "export", "readonly",
})


# M-LANG3 — JS/TS global builtins: a bare unresolved callee naming one
# of these is a known runtime boundary ('external'), not a resolution
# gap. Mirrors the role of KNOWN_BUILTINS for Python.
JSTS_KNOWN_BUILTINS = frozenset({
    "JSON", "Math", "Object", "Array", "Promise", "Number", "String",
    "Boolean", "Date", "Map", "Set", "WeakMap", "WeakSet", "Symbol",
    "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
    "parseInt", "parseFloat", "isNaN", "isFinite", "structuredClone",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "queueMicrotask", "BigInt", "Reflect", "Proxy", "Intl", "URL",
    "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController",
    "Buffer", "process", "globalThis", "require", "String", "Atomics",
    "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
})


def classify_jsts(call_node: dict, call_target: str, is_local: bool) -> str:
    """M-LANG3 terminal classifier for the JS/TS frontend. The Python
    classifier's SHAPE fits JS (dotted+local receiver → dynamic, dotted
    external head → external, bare builtin → external, bare local →
    dynamic, else a genuine gap) — only the tables and two JS-specific
    dynamics differ:
      * `import(...)` — genuine runtime module dispatch → dynamic;
      * `this.x(...)` — instance state is runtime-bound → dynamic
        (the R4 receiver-honesty rule, JS spelling)."""
    if call_node.get("effectKind"):
        return "external"
    if call_target == "import":
        return "dynamic"
    if call_target.split(".", 1)[0] == "this":
        return "dynamic"
    if "." in call_target:
        return "dynamic" if is_local else "external"
    if call_target in JSTS_KNOWN_BUILTINS:
        return "external"
    if is_local:
        return "dynamic"
    return "unresolved"


# M-RESOLVE, C++ spelling — the language's OWN runtime, reached by a bare
# name. `strstr` is <cstring>; calling it `unresolved` claims the linker
# failed at something findable, and C++'s honesty headline depends on
# that marker MEANING the overload gap it was built for. Mirrors
# JSTS_KNOWN_BUILTINS and RUST_PRELUDE.
#
# Written down rather than generated (the M-TABLES question): C++ has no
# runtime to ask — `isCppStdHeader` is already a stated convention for
# the same reason — so this is a list of the free functions that actually
# appear, extended when a census shows more, never guessed wider.
CPP_STD_CALLS = frozenset({
    # <cstring>
    "strstr", "strlen", "strcmp", "strncmp", "strcpy", "strncpy", "strcat",
    "strchr", "strrchr", "strtok", "strdup", "memcpy", "memset", "memcmp",
    "memmove",
    # <cstdlib>
    "atoi", "atof", "atol", "strtol", "strtod", "malloc", "calloc",
    "realloc", "free", "abs", "labs", "rand", "srand", "qsort", "bsearch",
    "getenv", "exit", "abort",
    # <cmath>
    "sqrt", "pow", "fabs", "floor", "ceil", "round", "sin", "cos", "tan",
    "log", "log10", "exp", "fmod", "fmin", "fmax",
    # <cstdio> — the non-effectful formatters (fopen/fread carry effects
    # and never reach here)
    "sprintf", "snprintf", "sscanf",
    # <cctype>
    "isdigit", "isalpha", "isalnum", "isspace", "tolower", "toupper",
})

# gtest/gmock assertion MACROS. A macro is not a function the linker
# could ever resolve, so reporting one as a resolution gap is a claim
# about our own completeness that is simply false.
_GTEST_MACRO = re.compile(r"^(EXPECT|ASSERT)_[A-Z_]+$")


def classify_cpp(call_node: dict, call_target: str, is_local: bool) -> str:
    """M-LANG5a terminal classifier for the C++ frontend (no build
    graph — honesty carries the weight):
      * frontend-stamped effectKind → external (printf/fopen/system/…);
      * template call (`clamp2<double>`) → dynamic — the dispatch is
        COMPILE-TIME-resolved, which static single-file analysis
        genuinely cannot see (the plan's named rule);
      * `this->`/`this.` receiver → dynamic (instance state, R4);
      * `ns::f` / `Class::f` qualified → external (a named boundary);
      * member call on a local/param receiver (`c.area()`,
        `shapes->at(i)`) → dynamic; on a non-local receiver → external;
      * bare + local → dynamic; bare unresolved → UNRESOLVED — this is
        where the OVERLOAD GAP honestly lands: the linker refuses to
        pick among 2+ definitions, so the call is a resolution gap the
        tooltip can name, never a guessed edge."""
    if call_node.get("effectKind"):
        return "external"
    if "<" in call_target:
        return "dynamic"
    head = call_target.split("->", 1)[0].split(".", 1)[0]
    if head == "this":
        return "dynamic"
    if "::" in call_target:
        return "external"
    if "." in call_target or "->" in call_target:
        return "dynamic" if is_local else "external"
    if is_local:
        return "dynamic"
    if call_target in CPP_STD_CALLS or _GTEST_MACRO.match(call_target):
        return "external"
    return "unresolved"


# M-RUST — the Rust PRELUDE, the names in scope in every file without a
# `use`. A bare callee naming one of these is the language's own runtime,
# not a resolution gap: `Some(x)` CONSTRUCTS an Option, and reporting it
# `unresolved` would claim the linker failed at something there was never
# anything to find. Mirrors JSTS_KNOWN_BUILTINS.
#
# Unlike Python's stdlib (M-TABLES generates it, because 192 roots cannot
# be remembered) the prelude is a short, closed list fixed by the language
# itself, and there is no rustc here to ask — so it is written down, and
# the reason it may be is that it is complete by definition rather than
# by recollection.
RUST_PRELUDE = frozenset({
    # Option / Result variant constructors — the two that actually appear
    # in call position constantly.
    "Some", "None", "Ok", "Err",
    # Conversion + container constructors reached bare.
    "drop", "format", "vec", "String", "Vec", "Box", "Default",
    "From", "Into", "TryFrom", "TryInto", "Clone", "ToString",
})


def classify_rust(call_node: dict, call_target: str, is_local: bool) -> str:
    """M-RUST terminal classifier for the Rust frontend.

    The Python classifier's SHAPE fits Rust (dotted+local receiver ->
    dynamic, qualified head -> external, bare local -> dynamic, else a
    genuine gap); what differs is what each SPELLING proves:

      * frontend-stamped effectKind -> external (fs/process/log/http);
      * a MACRO (`name!`) whose effect the table did not know -> external:
        it expands to code this frontend cannot see, and saying
        `unresolved` would claim a resolution gap where there is a
        deliberate blind spot (§5.3 already flags the node);
      * turbofish (`parse::<i64>`) -> dynamic: the dispatch is
        COMPILE-TIME-resolved, the same call the C++ template rule makes;
      * `self.` receiver -> dynamic (instance state, R4);
      * any OTHER method call (`x.f`, `a.b().c`) -> dynamic when the head
        is a local or a param, external otherwise. Rust's trait objects
        are the honest case for this: `sink.deliver(..)` on a
        `Box<dyn Sink>` IS runtime dispatch, and naming one impl would be
        a guess;
      * `::` path -> external (a named boundary the linker did not take);
      * bare + local -> dynamic; bare unresolved -> UNRESOLVED, a real
        resolution gap (Rust has no overloading, so unlike C++ this is
        never the ambiguity case — it means the linker found nothing)."""
    if call_node.get("effectKind"):
        return "external"
    if call_target.endswith("!"):
        return "external"
    if "::<" in call_target:
        return "dynamic"
    head = call_target.split(".", 1)[0]
    if head == "self":
        return "dynamic"
    if "." in call_target:
        return "dynamic" if is_local else "external"
    if "::" in call_target:
        return "external"
    if call_target in RUST_PRELUDE:
        return "external"
    if is_local:
        return "dynamic"
    return "unresolved"


def classify_nonpython(call_node: dict, call_target: str) -> str:
    """M-LANG2b terminal classifier for non-Python frontends (bash first).

    Decision (c) of PLAN-M-LANG: non-Python frontends stamp effectKind at
    PARSE/LINK time (tables.mjs is the one vocabulary home), so the
    extractor trusts the IR instead of keeping a per-language builtins
    table: effect-bearing call -> 'external' (curl/psql/ssh/...);
    '$'-interpolated callee or `eval` -> 'dynamic' (genuine runtime
    dispatch, the R3 honesty split); neutral shell builtin -> 'external';
    anything else -> 'unresolved' (a genuine gap -- e.g. a call into a
    file the linker could not resolve)."""
    if call_node.get("effectKind"):
        return "external"
    if "$" in call_target or call_target == "eval":
        return "dynamic"
    if call_target in NONPYTHON_NEUTRAL_BUILTINS:
        return "external"
    return "unresolved"


# ─────────────────────────────────────────── helpers ─────────────────

def module_path_from_file(file_path: str) -> str:
    """`main.py` -> `main`. Matches cross_file_link.py:file_to_module_path
    for the simple case (thread fixtures live in a flat directory)."""
    if file_path.endswith(".py"):
        return file_path[:-3]
    return file_path


def find_node(ir: dict, node_id: str) -> Optional[dict]:
    for n in ir.get("nodes", []):
        if n["id"] == node_id:
            return n
    return None


def function_name(ir: dict, fn_id: str) -> str:
    n = find_node(ir, fn_id)
    if not n or "name" not in n:
        return fn_id
    # Methods: qualify by the enclosing class so two classes' `forward`
    # (or any same-named method) don't collide on `<module>:forward`.
    # Module-level functions are unaffected (parent is the module, not a
    # class_def), so existing thread snapshots are unchanged.
    parent_id = n.get("parentId")
    if parent_id:
        parent = find_node(ir, parent_id)
        if parent and parent.get("type") == "class_def" and "name" in parent:
            return f"{parent['name']}.{n['name']}"
    return n["name"]


def qualified(file_path: str, fn_id: str, ir: dict) -> str:
    """Stable, human-readable thread-node id: `<module>:<fn_name>`."""
    return f"{module_path_from_file(file_path)}:{function_name(ir, fn_id)}"


# M-FLOW.1 — a SCRIPT'S BODY IS ITS MAIN. A backend script with only
# top-level statements has no function a thread could seed on, so the
# whole invoked layer of a real codebase (77 .sh + 153 .mjs scripts run by
# a platform command) had no thread. `MODULE_SEED` is the pseudo node id
# a discoverer or a manual seed names for "the file's top level"; the
# walk covers the statements that EXECUTE when the file runs — never a
# function or class body merely defined there (a call to a local function
# at top level still steps into it, through the usual resolution).
MODULE_SEED = "module"


def module_descendants(ir: dict) -> List[dict]:
    """Top-level statements and what is structurally inside them, stopping
    at every function_def / class_def: a definition is not executed by
    being defined."""
    by_parent: Dict[str, List[dict]] = {}
    for n in ir.get("nodes", []):
        by_parent.setdefault(n.get("parentId") or "", []).append(n)
    out: List[dict] = []
    stack = [""]
    while stack:
        pid = stack.pop()
        for child in by_parent.get(pid, []):
            if child.get("type") in ("function_def", "class_def"):
                continue
            out.append(child)
            stack.append(child["id"])
    return out


def module_seed_node(file_path: str) -> dict:
    return {"id": MODULE_SEED, "type": "module", "name": os.path.basename(file_path),
            "parentId": None, "line": 1}


def descendants(ir: dict, root_id: str) -> List[dict]:
    """All nodes structurally inside `root_id` (parentId chain)."""
    by_parent: Dict[str, List[dict]] = {}
    for n in ir.get("nodes", []):
        by_parent.setdefault(n.get("parentId") or "", []).append(n)
    out: List[dict] = []
    stack = [root_id]
    while stack:
        pid = stack.pop()
        for child in by_parent.get(pid, []):
            out.append(child)
            stack.append(child["id"])
    return out


def enclosing_if(call_id: str, if_ids: List[str]) -> Optional[str]:
    """Return the id of the innermost if_stmt enclosing `call_id`, if any.
    Used to mark a call-site edge as conditional. Longest prefix wins."""
    matches = [i for i in if_ids if call_id.startswith(i + "/")]
    if not matches:
        return None
    matches.sort(key=len, reverse=True)
    return matches[0]


# M17.2 / M17.3 — control-flow container support. The kinds the extractor
# promotes to thread "container" nodes. M17.2 shipped try / except /
# finally / while; M17.3 adds for_loop and if_stmt (the latter split into
# if_then / if_else arms by source position — see _if_arm_container).
# M-COMP adds `comprehension` — a loop the renderer and the round-trip
# detector had no way to see.
CONTAINER_TYPES = frozenset({
    "try_stmt", "except_handler", "finally_block", "while_loop",
    "for_loop", "if_stmt", "comprehension",
})


def walk_container_chain(ir: dict, call_id: str) -> List[dict]:
    """Walk a call site's IR parentId chain. Returns the container ancestors
    between the call and its enclosing function, innermost first. Stops at
    the first function_def (or module). Non-container ancestors (class_def)
    are skipped silently — they may appear between the call and a container,
    but they don't themselves promote to thread containers."""
    by_id: Dict[str, dict] = {n["id"]: n for n in ir.get("nodes", [])}
    out: List[dict] = []
    cur = by_id.get(call_id)
    if cur is None:
        return out
    pid = cur.get("parentId")
    while pid:
        parent = by_id.get(pid)
        if parent is None:
            break
        if parent.get("type") == "function_def":
            break
        if parent.get("type") in CONTAINER_TYPES:
            out.append(parent)
        pid = parent.get("parentId")
    return out


def _container_thread_id(file_path: str, ir_id: str) -> str:
    """Stable thread-id for an IR container node. Format:
    `<module>:<ir_path_without_module_prefix>` — keeps the same `module:…`
    shape as function thread ids (qualified()) so all thread ids cluster
    in a single namespace. Example:
        db.py + module/insert.fn/try@0 → db:insert.fn/try@0
    The slash inside the suffix is intentional — it's just a stable key
    string; the renderer keys structural logic off `irNodeId`, not this id."""
    short = ir_id[len("module/"):] if ir_id.startswith("module/") else ir_id
    return f"{module_path_from_file(file_path)}:{short}"


def _container_kind_subtype(ir_node: dict) -> str:
    t = ir_node.get("type")
    return {
        "try_stmt": "try",
        "except_handler": "except",
        "finally_block": "finally",
        "while_loop": "while",
        "for_loop": "for",
        "comprehension": "comprehension",
        # if_stmt resolves to if_then / if_else per arm in
        # _if_arm_container, never through this map.
    }.get(t, "unknown")


#: How each language spells the separator in a for-each header. Absent =
#: `in`, which is Python's and bash's and the safe default for a frontend
#: that has not declared otherwise.
_FOR_SEPARATOR = {"python": "in", "bash": "in", "jsts": "of", "cpp": ":", "rust": "in"}


def _container_label(ir_node: dict, language: str = "python") -> str:
    """Human-readable label for the container's chip in the renderer.
    except / while / for carry their exception type / condition / loop
    header; try + finally are bare keyword labels. if_stmt is labelled
    per-arm in _if_arm_container, not here."""
    sub = _container_kind_subtype(ir_node)
    if sub == "except":
        exc = ir_node.get("exceptType")
        return f"except {exc}" if exc else "except"
    if sub == "while":
        cond = ir_node.get("condition")
        return f"while {cond}" if cond else "while"
    if sub == "for":
        target = ir_node.get("target")
        iter_name = ir_node.get("iterName")
        if target and iter_name:
            # M-LANG QA — the SEPARATOR is the language's own word, and
            # where a language has more than one it is READ FROM THE
            # SOURCE, never assumed: JS `for…in` walks keys and `for…of`
            # walks values, so the frontend stamps `iterSep` and this
            # prefers it. The per-language default covers the frontends
            # with only one spelling. Hardcoding `in` made a C++ range-for
            # read "for & raw in lines" for
            # `for (const std::string& raw : lines)` — Python's word on
            # C++ code, which is what the classic-for branch below already
            # existed to avoid.
            sep = ir_node.get("iterSep") or _FOR_SEPARATOR.get(language, "in")
            return f"for {target} {sep} {iter_name}"
        # M-LANG QA — a C-style loop has no iterable: the frontend puts
        # the whole header in `target` and the "in" would read as
        # Python ("for int i = 0; in i < count"). Python always emits
        # both fields, so this branch never fires for Python.
        if target:
            return f"for {target}"
        return "for"
    if sub == "comprehension":
        # Reads like the loop it is, with the form named so the reader can
        # find it in the source: "listcomp for u in urls".
        #
        # ONE WORD for the noun, deliberately. ThreadContainerNode's chip
        # splits a label at its FIRST space into an uppercased head and a
        # kept tail, so "list comp: for u in urls" would render "LIST  comp:
        # for u in urls" — the form name broken across the two type styles.
        kind = ir_node.get("compKind") or "list"
        noun = "genexp" if kind == "generator" else f"{kind}comp"
        target = ir_node.get("target")
        iter_name = ir_node.get("iterName")
        if target and iter_name:
            return f"{noun} for {target} in {iter_name}"
        return noun
    return sub


def _if_arm_container(file_path: str, if_ir: dict, call_line: int) -> Tuple[str, str, str]:
    """M17.3 — resolve an `if_stmt` ancestor into one of its two arms for a
    given call site, returning (thread_id, containerKind, label).

    The arm is decided by source position: a call on or after the if's
    `elseLine` (the start line of the `else:` / `elif` arm, recorded by the
    parser) sits in the else arm; anything before it is in the then arm. An
    if with no trailing arm has no elseLine, so every call is then-arm.

    The two arms get distinct thread ids (`…#then` / `…#else`) off the same
    IR node so they render as separate bordered regions. The then chip reads
    `IF <cond>`; the else chip reads `ELSE`."""
    else_line = if_ir.get("elseLine")
    base = _container_thread_id(file_path, if_ir["id"])
    if else_line is not None and call_line >= else_line:
        return f"{base}#else", "if_else", "else"
    cond = if_ir.get("condition")
    # M-LANG QA — flattened case/switch constructs (bash case, jsts/cpp
    # switch) arrive as if_stmt with a self-labelling condition
    # ("case \"$1\"", "switch (argc)"); prefixing "if" doubled the
    # keyword ("if case …"). Cosmetic only, never classification.
    if cond and (cond.startswith("case ") or cond.startswith("switch")):
        return f"{base}#then", "if_then", cond
    return f"{base}#then", "if_then", (f"if {cond}" if cond else "if")


def resolve_same_file(ir: dict, call_target: str) -> Optional[str]:
    """Find a top-level function_def in `ir` whose name == `call_target`.
    M4a's linker only emits cross-file reference edges; same-file calls
    have no edge, so the thread extractor has to do its own lookup or
    every local helper would misclassify as 'dynamic'."""
    if "." in call_target:
        return None  # qualified name -- not a same-file bare reference
    matches: List[str] = []
    for n in ir.get("nodes", []):
        if n.get("type") == "function_def" and n.get("name") == call_target:
            # Only consider module-level defs (parentId None) -- nested
            # closures and class methods are out of scope for wave 2.
            if n.get("parentId") in (None, ""):
                matches.append(n["id"])
    if not matches:
        return None
    # M-CONTRACT.1 (polyglot fixture, 2026-09-06) — OVERLOAD HONESTY
    # carried into the extractor: the C++ frontend refuses a same-file
    # reference edge when a bare name has 2+ definitions (the compiler
    # picks; guessing lies), but this fallback then picked the FIRST
    # definition anyway and rendered the guess as a step. Two or more
    # same-file definitions in a non-Python IR is ambiguous → None, so
    # the call classifies `unresolved` (a named gap). Python is exempt
    # (no overloads; every python thread snapshot stays byte-identical).
    if ir.get("language", "python") != "python" and len(matches) > 1:
        return None
    return matches[0]


def imported_name_map(ir: dict) -> Dict[str, str]:
    """name -> source module, from the file's `from X import a, b` nodes.

    M-FS8 (full-scope review P3): a bare call to a name imported from an
    EXTERNAL module is not a resolution gap — the import says exactly
    where it comes from. `jsonify` next to `request.args.get` used to
    split into `unresolved` (ghosted "couldn't find this") vs `external`
    for two names from the same `from flask import …` line.
    """
    out: Dict[str, str] = {}
    for n in ir.get("nodes", []):
        if n.get("type") == "import_from" and n.get("module"):
            for nm in n.get("names", []) or []:
                out[nm.split(" as ")[-1].strip()] = n["module"]
    return out


def resolve_project_method(project_ir: dict, qpath_raw: str) -> Optional[Tuple[str, str]]:
    """M-FS2 (full-scope review P1): map a viaLocal edge's qualifiedTarget
    (``module:Class.method``) to ``(file, ir_node_id)`` when the method
    structurally exists in a project file.

    A receiver-resolved call whose target lives IN the project is a step
    the thread walks into, not an external terminal — the old behaviour
    rendered `reconciler.shortages()` as an external chip whose tooltip
    claimed the source "can't be resolved" while the same thread painted
    the method's containers. Inherited methods (``model.parameters`` on an
    nn.Module subclass) don't structurally exist in the file and honestly
    stay external terminals.
    """
    if not qpath_raw or ":" not in qpath_raw:
        return None
    module, dotted = qpath_raw.split(":", 1)
    parts = dotted.split(".")
    if len(parts) != 2:
        return None
    cls, method = parts
    node_id = f"module/{cls}.class/{method}.fn"
    for file_path, ir in project_ir.items():
        if ir.get("modulePath") != module:
            continue
        if any(n.get("id") == node_id for n in ir.get("nodes", [])):
            return (file_path, node_id)
    return None


def classify_unresolved(call_target: str, is_local: bool) -> str:
    """Map an unresolvable bare/qualified callTarget to a thread kind.
    Returns one of: 'external', 'dynamic', 'unresolved'.

    `is_local` = the HEAD of the (possibly dotted) target is bound as a
    local assignment in the enclosing function. Bare form: `model =
    select_model(...)` then `model(...)`. Dotted form (R4): `conn =
    _get_conn()` then `conn.execute(...)` — the receiver is a runtime-
    bound local, so the method target is only knowable at runtime.
    Both are GENUINE runtime dispatch -> 'dynamic'.

    The honest distinction (R3): a bare name that is neither a local
    binding nor resolvable by the linker is a RESOLUTION GAP -> 'unresolved'
    -- NOT 'dynamic'. Flattening the two lied: it said "runtime-determined"
    (an unfixable property) about something that's merely "couldn't find it"
    (often a fixable missing import / linker miss).

    R4 extends the same honesty to dotted targets: `conn.execute` was
    previously classified 'external', sending the M13 resolver chasing a
    module named `conn` and surfacing "base module 'conn' is not
    importable" — a lie about a perfectly ordinary local receiver.
    (M17.1 deliberately declined to *resolve* lowercase-bound receivers;
    R4 doesn't resolve them either — it just stops mislabelling them.)"""
    if "." in call_target:
        if is_local:
            return "dynamic"  # method on a runtime-bound local receiver
        return "external"  # e.g. math.sqrt, json.loads, conditions.get
    if call_target in DYNAMIC_BUILTINS:
        return "dynamic"   # getattr / setattr / ... -- true runtime dispatch
    if call_target in KNOWN_BUILTINS:
        return "external"
    if is_local:
        # Local variable invoked at runtime -- genuine dynamic dispatch
        # (the callable was bound at runtime, e.g. via getattr upstream).
        return "dynamic"
    # Bare name, not a local binding, not resolvable -- a resolution gap.
    return "unresolved"


# ─────────────────────────────────────────── extraction ──────────────

# §A — repeated call SITES are distinct ordered events. Terminals used to be
# keyed purely on their target (`<kind>:<target>`), so a target called from
# several sites (F.relu ×3, a helper in two places) collapsed to ONE node,
# destroying position/order — the core information of a data path. We now make
# terminals call-site-distinct (occurrence-suffixed id + the real call-site
# irNodeId). PARKED: setting this True restores the old collapse-by-target
# behaviour, should a view-layer "collapse repeated" toggle ever want it as a
# base (revert-in-wiring, kept in history).
COLLAPSE_REPEATED_TERMINALS = False


def extract(project_ir: Dict[str, dict], seed_file: str, seed_id: str) -> dict:
    if seed_file not in project_ir:
        raise SystemExit(f"seed file not in project IR: {seed_file}")
    seed_ir = project_ir[seed_file]
    if seed_id != MODULE_SEED and not find_node(seed_ir, seed_id):
        raise SystemExit(f"seed id not in {seed_file}: {seed_id}")

    nodes: List[dict] = []
    edges: List[dict] = []
    nodes_by_id: Dict[str, dict] = {}
    term_seq: Dict[str, int] = {}  # base terminal id -> occurrence count (global)
    visited: Dict[Tuple[str, str], str] = {}  # (file, fn_id) -> thread_id
    # M-FS8 — per-file `from X import name` maps + the set of project
    # module paths (an import FROM a project module that the linker
    # didn't resolve is a genuine gap and must stay `unresolved`).
    imports_map_cache: Dict[str, Dict[str, str]] = {}
    project_modules = {
        ir.get("modulePath") for ir in project_ir.values() if ir.get("modulePath")
    }

    def terminal_id_for(base: str) -> str:
        # Call-site-distinct terminal id. Additive: occurrence 0 keeps the bare
        # `<kind>:<target>` id (existing thread-node ids unchanged), repeats get
        # `@k` so each site is its own ordered node. Counter is global across
        # the whole thread (the node list aggregates all visited functions), so
        # a target repeated anywhere stays unique.
        if COLLAPSE_REPEATED_TERMINALS:
            return base
        occ = term_seq.get(base, 0)
        term_seq[base] = occ + 1
        return base if occ == 0 else f"{base}@{occ}"
    # M17.2 — dedup (from, to) pairs across container-chain emissions so
    # a function with N calls in one try block doesn't emit N copies of
    # the outer-container→try edge. Containment edges are logically a
    # tree; the renderer needs each (parent, child) at most once.
    contains_emitted: set[Tuple[str, str]] = set()

    def add_node(node: dict) -> str:
        if node["id"] in nodes_by_id:
            return node["id"]
        nodes.append(node)
        nodes_by_id[node["id"]] = node
        return node["id"]

    def add_edge(from_id: str, to_id: str, kind: str, ir_source: Optional[str],
                 label: Optional[str] = None) -> None:
        edge = {
            "from": from_id,
            "to": to_id,
            "kind": kind,
            "irSource": ir_source,
        }
        # M24 — flow edges carry an explicit semantic label ("always" on
        # try→finally joins). Additive: the key only appears when set, so
        # pre-M24 edge shapes are byte-identical.
        if label is not None:
            edge["label"] = label
        edges.append(edge)

    def emit_container_chain(file_path: str, ir: dict, call_id: str,
                             target_thread_id: str, call_line: int) -> None:
        """M17.2 / M17.3 — promote each control-flow container ancestor of
        `call_id` to a thread "container" node, and nest `target_thread_id`
        inside the innermost container via a `contains` edge. Outer
        containers nest inner ones the same way. Idempotent: re-calling with
        the same (container, child) pair is a no-op.

        if_stmt ancestors are resolved to a specific then/else arm using
        `call_line` (the call site's own source line) against the if's
        `elseLine` (M17.3) — so a call in the else branch lands in a distinct
        `if_else` container from one in the then branch. `call_line` is passed
        in rather than re-derived from `call_id`, because the parser can emit
        two sibling nodes with the same structural id (e.g. `density =` in
        both the then and else arm of one if) — an id lookup would collapse
        them to one line and misfile one arm."""
        chain = walk_container_chain(ir, call_id)
        prev = target_thread_id
        for ctr_ir in chain:
            if ctr_ir.get("type") == "if_stmt":
                ctr_id, sub, label = _if_arm_container(file_path, ctr_ir, call_line)
            else:
                ctr_id = _container_thread_id(file_path, ctr_ir["id"])
                sub = _container_kind_subtype(ctr_ir)
                label = _container_label(ctr_ir, ir.get("language", "python"))
            if ctr_id not in nodes_by_id:
                add_node({
                    "id": ctr_id,
                    "kind": "container",
                    "containerKind": sub,
                    "label": label,
                    "file": file_path,
                    "irNodeId": ctr_ir["id"],
                    "preview": None,
                })
            edge_key = (ctr_id, prev)
            if edge_key not in contains_emitted:
                contains_emitted.add(edge_key)
                add_edge(ctr_id, prev, "contains", ctr_ir["id"])
            prev = ctr_id

    # M24 — per-function scope info for the deferred flow-edge pass:
    # (file_path, fn_ir_id, fn_thread_id, placed). `placed` = the call
    # sites this function emitted, as (thread_node_id, line, call_ir_id)
    # — the fork-arrow predecessor search needs their lines and chains.
    # Flow edges are emitted AFTER the walk + seed-return processing,
    # because return-only containers (a finally or if arm holding just a
    # `return`) only come into existence via the seed-return chain.
    flow_scopes: List[Tuple[str, str, str, List[Tuple[str, int, str]]]] = []

    def same_arm(line_a: int, line_b: int, anc_if: dict) -> bool:
        """True when both lines fall on the SAME side of an if's else
        boundary — keeps a predecessor search from reaching across into a
        sibling arm. No else → one arm, always same."""
        el = anc_if.get("elseLine")
        if el is None:
            return True
        return (line_a >= el) == (line_b >= el)

    def find_predecessor(file_path: str, ir: dict, placed: List[Tuple[str, int, str]],
                         target_line: int, target_ir_id: str,
                         fn_thread_id: str) -> str:
        """§5.6a — the node that executes immediately before `target` in
        the SAME control-flow scope, for an edge sympathetic to execution
        order. Shared by the M24 fork-arrow pass and seed-return sourcing.

        Preference: (1) the last placed call before `target` by source
        line, in the same container chain and same if-arm; else (2) the
        innermost emitted enclosing container (a return after a try/finally
        joins the band that always runs, not the bare function head); else
        (3) the function node itself.
        """
        target_chain = walk_container_chain(ir, target_ir_id)
        target_chain_ids = [a["id"] for a in target_chain]
        best: Optional[Tuple[int, str]] = None
        for node_id, line, call_ir_id in placed:
            if line >= target_line or call_ir_id == target_ir_id:
                continue
            chain = walk_container_chain(ir, call_ir_id)
            if [a["id"] for a in chain] != target_chain_ids:
                continue
            if not all(same_arm(line, target_line, a) for a in target_chain
                       if a.get("type") == "if_stmt"):
                continue
            if best is None or line > best[0]:
                best = (line, node_id)
        if best is not None:
            return best[1]
        for anc in target_chain:
            if anc.get("type") == "if_stmt":
                cid, _, _ = _if_arm_container(file_path, anc, target_line)
            else:
                cid = _container_thread_id(file_path, anc["id"])
            if cid in nodes_by_id:
                return cid
        return fn_thread_id

    def emit_flow_edges() -> None:
        """M24 — explicit control-flow joins between sibling containers.

        Visual grammar (review-pinned): SOLID = always joins, DASHED =
        conditional. Two emissions per function scope:

          * try → finally — kind "flow", label "always": execution joins
            the finally band no matter how the try band exits. A finally
            is paired with the nearest preceding try SIBLING whose line
            span contains it (never by @N index alignment — a bare try
            between two try/finallys would desync the counters).
          * fork arrows into if arms — kind "conditional" (the renderer
            already dashes that kind), NO label: an arrow into an arm
            must never claim the arm always executes. Source = the last
            placed call in the SAME scope before the if in source order;
            falls back to the if's innermost emitted enclosing container
            (the nested-elif case — a same-scope predecessor would
            otherwise be fished out of a sibling arm), then to the
            function node.

        try→except / except→finally are deliberately NOT emitted —
        parked (PLAN-v5 §5.6); `flow` is additive so they layer on
        later. Only containers with thread presence participate.
        """
        for file_path, fn_id, fn_thread_id, placed in flow_scopes:
            ir = project_ir[file_path]
            by_ir = {n["id"]: n for n in ir.get("nodes", [])}
            prefix = fn_id + "/"
            ctrs = [n for n in nodes
                    if n.get("kind") == "container"
                    and n.get("file") == file_path
                    and (n.get("irNodeId") or "").startswith(prefix)]

            # ── try → finally joins ──────────────────────────────
            trys = [n for n in ctrs if n.get("containerKind") == "try"]
            fins = sorted((n for n in ctrs if n.get("containerKind") == "finally"),
                          key=lambda n: n["irNodeId"])
            for fin in fins:
                f_ir = by_ir.get(fin["irNodeId"]) or {}
                candidates = []
                for t in trys:
                    t_ir = by_ir.get(t["irNodeId"]) or {}
                    if (t_ir.get("parentId") == f_ir.get("parentId")
                            and t_ir.get("line", 0) <= f_ir.get("line", 0)
                            <= t_ir.get("endLine", -1)):
                        candidates.append((t_ir.get("line", 0), t["id"]))
                if candidates:
                    _, try_id = max(candidates)  # nearest preceding sibling
                    add_edge(try_id, fin["id"], "flow", fin["irNodeId"],
                             label="always")

            # ── exception-path joins (§5.6a) ─────────────────────
            # try → except = "on error": a CONDITIONAL entry (only taken
            # when the try raises) — dashed, error-tinted (the renderer
            # reds an edge landing on an except band). except → finally =
            # "always": the handler falls through to the finally just like
            # the success path. Grammar holds: solid = always joins,
            # dashed = conditional. Each except is paired with the
            # nearest enclosing try by same parent + line-span containment
            # (the try_stmt span covers the whole try/except/finally).
            excepts = sorted((n for n in ctrs if n.get("containerKind") == "except"),
                             key=lambda n: n["irNodeId"])

            def enclosing_try(band: dict) -> Optional[dict]:
                """The nearest try thread-node whose IR line-span contains
                `band` and shares its parent."""
                b_ir = by_ir.get(band["irNodeId"]) or {}
                best = None
                for t in trys:
                    t_ir = by_ir.get(t["irNodeId"]) or {}
                    if (t_ir.get("parentId") == b_ir.get("parentId")
                            and t_ir.get("line", 0) <= b_ir.get("line", 0)
                            <= t_ir.get("endLine", -1)):
                        if best is None or t_ir.get("line", 0) > best[0]:
                            best = (t_ir.get("line", 0), t)
                return best[1] if best else None

            for exc in excepts:
                exc_ir = by_ir.get(exc["irNodeId"]) or {}
                try_node = enclosing_try(exc)
                if try_node is None:
                    continue
                add_edge(try_node["id"], exc["id"], "conditional",
                         exc["irNodeId"], label="on error")
                # except → finally, within the same try construct.
                t_ir = by_ir.get(try_node["irNodeId"]) or {}
                for fin in fins:
                    f_ir = by_ir.get(fin["irNodeId"]) or {}
                    if (f_ir.get("parentId") == exc_ir.get("parentId")
                            and t_ir.get("line", 0) <= f_ir.get("line", 0)
                            <= t_ir.get("endLine", -1)
                            and f_ir.get("line", 0) > exc_ir.get("line", 0)):
                        add_edge(exc["id"], fin["id"], "flow", fin["irNodeId"],
                                 label="always")

            # ── fork arrows into if arms ─────────────────────────
            # Group emitted arm containers by their base if (irNodeId).
            arms_by_if: Dict[str, List[dict]] = {}
            for c in ctrs:
                if c.get("containerKind") in ("if_then", "if_else"):
                    arms_by_if.setdefault(c["irNodeId"], []).append(c)

            for if_ir_id in sorted(arms_by_if):
                if_ir = by_ir.get(if_ir_id) or {}
                if_line = if_ir.get("line", 0)
                # Last same-scope node before the if, by execution order.
                pred_id = find_predecessor(file_path, ir, placed,
                                           if_line, if_ir_id, fn_thread_id)
                # #then before #else.
                arms = sorted(arms_by_if[if_ir_id],
                              key=lambda c: 0 if c["containerKind"] == "if_then" else 1)
                for arm in arms:
                    add_edge(pred_id, arm["id"], "conditional", if_ir_id)

    def visit(file_path: str, fn_id: str, role: str) -> str:
        key = (file_path, fn_id)
        if key in visited:
            return visited[key]
        ir = project_ir[file_path]
        # M-FS8 — per-file import map for bare-name external classification.
        imports_map = imports_map_cache.setdefault(file_path, imported_name_map(ir))
        fn = find_node(ir, fn_id) or (module_seed_node(file_path) if fn_id == MODULE_SEED else {})
        thread_id = qualified(file_path, fn_id, ir)
        visited[key] = thread_id
        add_node({
            "id": thread_id,
            "kind": role,
            "label": fn.get("name", fn_id),
            "file": file_path,
            "irNodeId": fn_id,
            "preview": fn.get("docstring"),
        })

        # Collect descendants + if_stmt ids for conditional detection.
        # M-FLOW.1 — the module seed walks what RUNS at top level only.
        subtree = module_descendants(ir) if fn_id == MODULE_SEED else descendants(ir, fn_id)
        if_ids = [n["id"] for n in subtree
                  if n.get("type") == "if_stmt" and n.get("hasElse")]
        # R3 — names bound by an assignment anywhere in this function. A
        # bare callTarget in this set is a local variable invoked at
        # runtime (genuine dynamic dispatch); one NOT in it that the
        # linker also can't resolve is a resolution gap (`unresolved`).
        local_assign_names = {
            n.get("name") for n in subtree
            if n.get("type") == "assignment" and n.get("name")
        }
        # R4 — name -> RHS callTarget for call-valued assignments
        # (`conn = _get_conn()` => {"conn": "_get_conn"}). Lets a dynamic
        # terminal carry WHERE its receiver was bound (`receiverBoundFrom`)
        # so the renderer can say "receiver 'conn' is a local binding from
        # _get_conn()" instead of attempting a doomed module import.
        # Last assignment wins on rebind — subtree order is deterministic.
        local_assign_bindings = {
            n["name"]: n.get("callTarget")
            for n in subtree
            if n.get("type") == "assignment"
            and n.get("name")
            and n.get("valueKind") == "call"
            and n.get("callTarget")
            # An AUGMENTED assignment MUTATES the name, it does not bind it:
            # `total += compute()` says nothing about what `total` IS. Read
            # as a binding it produces a flatly false sentence in the
            # tooltip — the C++ review fixture's `router += Router::parse(raw)`
            # made `router.route` report "receiver 'router' is a local
            # binding from net::Router::parse()", when `router` is
            # default-constructed and never reassigned. The name stays in
            # `local_assign_names` above, because a mutated name IS a local
            # and a dotted call on it is still honest dynamic dispatch —
            # only the claim about WHERE it came from is dropped.
            and not n.get("augmented")
        }
        # §5.5a — a receiver is a runtime-bound local if its head name is
        # bound in THIS function by an assignment (above), a function
        # PARAMETER, or a FOR-LOOP target. All three are local bindings, so
        # a dotted call on them is honest dynamic dispatch, not a failed
        # external import. Params live on `fn` (not in `descendants`);
        # for-loop targets live on `for_loop` nodes in the subtree. Tuple
        # for-targets (`for k, v in ...`) split on commas; tuple-unpack
        # ASSIGNMENTS (`a, b = ...`) are not surfaced by the parser yet and
        # are a recorded residual gap (see PLAN-M28 §5.5a).
        param_names = {
            p.split("=", 1)[0].strip()
            for p in (fn.get("params") or [])
            if p and p.split("=", 1)[0].strip()
        }
        loop_target_names = {
            name.strip("() ")
            for n in subtree if n.get("type") == "for_loop"
            for name in (n.get("target") or "").split(",")
            if name.strip("() ") and name.strip("() ") != "?"
        }
        local_binding_names = local_assign_names | param_names | loop_target_names
        # Two call-site shapes the parser emits:
        #   1. `assignment` with valueKind=call -- the LHS=callable() form.
        #      callTarget = the bare/dotted name of the callee.
        #   2. `call` -- statement-level effect call (no LHS).
        #      funcName  = the bare/dotted name of the callee.
        # Normalise to a common shape and sort by id for determinism.
        call_sites: List[dict] = []
        # M-NEST L2f — carry the parser's nest-honesty flags onto the thread
        # terminal. nestsInnerCalls/nestExtracted let the view badge a step
        # whose source statement hides calls v1 did NOT decompose (chains,
        # comprehensions, literal-embedded calls) — the detected-but-not-
        # extracted backstop, so the agent map never has unmarked holes.
        def _nest_flags(node: dict) -> dict:
            out: dict = {}
            if node.get("nestsInnerCalls"):
                out["nestsInnerCalls"] = True
                out["nestExtracted"] = bool(node.get("nestExtracted"))
            return out

        for n in subtree:
            t = n.get("type")
            if t == "assignment" and n.get("valueKind") == "call":
                call_sites.append({
                    "id": n["id"],
                    "callTarget": n.get("callTarget") or "<unknown>",
                    "preview": n.get("preview"),
                    "line": n.get("line", 0),
                    "nested": bool(n.get("nested")),
                    # M-LANG2b — non-Python classification trusts the
                    # frontend-stamped effectKind (classify_nonpython).
                    "effectKind": n.get("effectKind"),
                    **_nest_flags(n),
                })
            elif t == "call":
                call_sites.append({
                    "id": n["id"],
                    "callTarget": n.get("funcName") or "<unknown>",
                    "preview": n.get("preview") or n.get("funcName"),
                    "line": n.get("line", 0),
                    # M-NEST: a nested (call-arg) call node. The marker rides
                    # onto the thread terminal so the default README/MCP
                    # projection collapses it (the seam guard) — no consumer
                    # sees expanded sub-calls unless it opts in.
                    "nested": bool(n.get("nested")),
                    "effectKind": n.get("effectKind"),
                    **_nest_flags(n),
                })
            elif t in ("return_stmt", "raise_stmt") and n.get("callTarget"):
                # M-NEST L1.5: a return/raise VALUE call (`return self.fc(x)`,
                # `raise ValueError(msg)`) runs just like any other call — render
                # it as a discrete step, not a silent part of the return arrow.
                # The seed's `return` terminal then sources from this step (see
                # the seed-return loop) so the path reads `… → fc → return`.
                call_sites.append({
                    "id": n["id"],
                    "callTarget": n.get("callTarget"),
                    "preview": n.get("value") or n.get("exc") or n.get("callTarget"),
                    "line": n.get("line", 0),
                    "nested": False,
                    **_nest_flags(n),
                })
        call_sites.sort(key=lambda n: n["id"])

        # Edges keyed by source IR id -> reference edges going out from this
        # function body. Lookup per call site is O(small) and avoids us
        # walking the full edge list per assignment.
        ref_edges_by_source: Dict[str, dict] = {}
        for e in ir.get("edges", []):
            if e.get("type") != "reference":
                continue
            ref_edges_by_source.setdefault(e["source"], e)

        # M24 — call sites this function places, for the flow-edge pass.
        placed: List[Tuple[str, int, str]] = []

        for call_node in call_sites:
            call_id = call_node["id"]
            call_line = call_node["line"]
            call_target = call_node["callTarget"]
            conditional = enclosing_if(call_id, if_ids) is not None
            edge_kind = "conditional" if conditional else "direct"
            # M-NEST: metadata spread onto terminals. `nested` is the seam guard
            # (default projection collapses sub-calls); nestsInnerCalls/
            # nestExtracted carry the parser's honesty verdict so the view can
            # badge a step whose statement hides uncaptured calls.
            terminal_extra: dict = {}
            if call_node.get("nested"):
                terminal_extra["nested"] = True
            if call_node.get("nestsInnerCalls"):
                terminal_extra["nestsInnerCalls"] = True
                terminal_extra["nestExtracted"] = bool(call_node.get("nestExtracted"))

            ref = ref_edges_by_source.get(call_id)
            if ref is not None:
                # M17.1: viaLocal edges point at the receiver's local
                # assignment (intra-file). The call itself is to an
                # external/project method on that receiver — surface it
                # as a terminal keyed on the resolved qualifiedTarget so
                # the M13 external-call resolver gets a real importable
                # name instead of the unresolvable `local.method` string.
                if ref.get("viaLocal"):
                    qpath_raw = ref.get("qualifiedTarget") or call_target
                    # M-FS2 — the receiver resolved to a method that lives
                    # IN the project: walk into it like any cross-file call
                    # (step node → click-to-edit), instead of the external
                    # terminal + failed-resolve tooltip contradiction.
                    project_target = resolve_project_method(project_ir, qpath_raw)
                    if project_target is not None:
                        t_file, t_id = project_target
                        child_thread_id = visit(t_file, t_id, role="step")
                        add_edge(thread_id, child_thread_id, edge_kind, call_id)
                        emit_container_chain(file_path, ir, call_id, child_thread_id, call_line)
                        placed.append((child_thread_id, call_line, call_id))
                        continue
                    # Convert the IR's `module:Sym.method` form to the
                    # dotted form the external-call resolver expects.
                    qpath_dotted = qpath_raw.replace(":", ".") if qpath_raw else call_target
                    terminal_id = terminal_id_for(f"external:{qpath_dotted}")
                    add_node({
                        "id": terminal_id,
                        "kind": "external",
                        "label": call_target,
                        "file": None,
                        "irNodeId": call_id,
                        "preview": call_node.get("preview"),
                        "qualifiedTarget": qpath_dotted,
                        "viaLocal": ref.get("viaLocal"),
                        **terminal_extra,
                    })
                    add_edge(thread_id, terminal_id, edge_kind, call_id)
                    emit_container_chain(file_path, ir, call_id, terminal_id, call_line)
                    placed.append((terminal_id, call_line, call_id))
                    continue
                target_file = ref.get("targetFile") or file_path
                if target_file in project_ir:
                    child_thread_id = visit(target_file, ref["target"], role="step")
                    add_edge(thread_id, child_thread_id, edge_kind, call_id)
                    emit_container_chain(file_path, ir, call_id, child_thread_id, call_line)
                    placed.append((child_thread_id, call_line, call_id))
                    continue
                # Reference into a file outside the project -- treat as external.
                terminal_id = terminal_id_for(f"external:{call_target}")
                add_node({
                    "id": terminal_id,
                    "kind": "external",
                    "label": call_target,
                    "file": None,
                    "irNodeId": call_id,
                    "preview": call_node.get("preview"),
                    **terminal_extra,
                })
                add_edge(thread_id, terminal_id, edge_kind, call_id)
                emit_container_chain(file_path, ir, call_id, terminal_id, call_line)
                placed.append((terminal_id, call_line, call_id))
                continue

            # Same-file resolver: linker only emits cross-file ref edges.
            local_id = resolve_same_file(ir, call_target)
            if local_id is not None:
                child_thread_id = visit(file_path, local_id, role="step")
                add_edge(thread_id, child_thread_id, edge_kind, call_id)
                emit_container_chain(file_path, ir, call_id, child_thread_id, call_line)
                placed.append((child_thread_id, call_line, call_id))
                continue

            # No reference edge -- classify as external/dynamic/unresolved
            # terminal. is_local discriminates genuine runtime dispatch
            # (a local var invoked here) from a true resolution gap. R4:
            # the check is on the HEAD of the target so `conn.execute`
            # with `conn = _get_conn()` reads as dynamic, not external.
            # M-LANG2b: non-Python frontends classify via the IR's own
            # effectKind/dynamic markers -- the Python builtins tables and
            # the local-binding heuristics stay Python-only.
            head = call_target.split(".", 1)[0]
            lang = ir.get("language", "python")
            if lang == "jsts":
                kind = classify_jsts(call_node, call_target,
                                     head in local_binding_names)
            elif lang == "cpp":
                # C++ receivers arrive as `x.f` OR `x->f` — the head
                # check must strip both accessors AND subscripts
                # (`shapes[i].area()` on a param) before the local test.
                cpp_head = call_target.split("->", 1)[0].split(".", 1)[0]
                cpp_head = cpp_head.split("[", 1)[0]
                # C++ params carry full declarations ("const Circle*
                # shapes") — the binding NAME is the last identifier
                # token, unlike Python's name[=default] shape.
                cpp_param_names = set()
                for p_raw in (fn.get("params") or []):
                    tokens = p_raw.replace("*", " ").replace("&", " ").split()
                    if tokens:
                        cpp_param_names.add(tokens[-1])
                kind = classify_cpp(call_node, call_target,
                                    cpp_head in (local_binding_names | cpp_param_names))
            elif lang == "rust":
                # Rust params are `pattern: Type`, so the binding NAME is
                # the text before the first colon with the binding modes
                # stripped — `mut buf: Vec<u8>` binds `buf`, and
                # `&mut self` binds `self`. Unlike C++'s `const T* x` the
                # name comes FIRST, so taking the last token would read
                # the TYPE as the binding.
                rust_head = call_target.split(".", 1)[0].split("[", 1)[0]
                rust_param_names = set()
                for p_raw in (fn.get("params") or []):
                    binding = p_raw.split(":", 1)[0]
                    for mode in ("&mut ", "&", "mut ", "ref "):
                        binding = binding.replace(mode, "")
                    binding = binding.strip()
                    if binding:
                        rust_param_names.add(binding)
                kind = classify_rust(call_node, call_target,
                                     rust_head in (local_binding_names | rust_param_names))
            elif lang != "python":
                kind = classify_nonpython(call_node, call_target)
            else:
                kind = classify_unresolved(call_target, head in local_binding_names)
            # M-FS8 — a bare name imported from an EXTERNAL module is an
            # external call with a known qualified target (flask.jsonify),
            # not a resolution gap. A PROJECT-module import with no ref
            # edge stays `unresolved` — that IS a linker miss, and saying
            # "external" about project code would be the M17.1 lie again.
            external_qualified: Optional[str] = None
            if kind == "unresolved":
                imported_module = imports_map.get(call_target)
                if imported_module and imported_module not in project_modules:
                    kind = "external"
                    external_qualified = f"{imported_module}.{call_target}"
            terminal_id = terminal_id_for(f"{kind}:{call_target}")
            node = {
                "id": terminal_id,
                "kind": kind,
                "label": call_target,
                "file": None,
                "irNodeId": call_id,
                "preview": call_node.get("preview"),
                **terminal_extra,
            }
            if external_qualified:
                node["qualifiedTarget"] = external_qualified
            # M-LANG2b — non-Python external terminals carry the
            # frontend-stamped effectKind so the renderer colours them
            # from IR data instead of the Python-vocabulary tables in
            # colour_for_node.ts. Gated off python so every existing
            # thread snapshot stays byte-identical.
            if (ir.get("language", "python") != "python"
                    and kind == "external" and call_node.get("effectKind")):
                node["effectKind"] = call_node["effectKind"]
            # R4 + §5.5a — a dotted dynamic terminal carries HOW its
            # receiver was bound, for the honest tooltip line. Only a
            # call-valued local assignment has a binding callee
            # (`receiverBoundFrom`); a parameter or loop target is bound
            # without one, so it carries only the kind. Precedence
            # local-call > param > loop matches the union + Python rebind.
            if kind == "dynamic" and "." in call_target:
                if head in local_assign_bindings:
                    node["receiverBoundKind"] = "local-call"
                    node["receiverBoundFrom"] = local_assign_bindings[head]
                elif head in param_names:
                    node["receiverBoundKind"] = "param"
                elif head in loop_target_names:
                    node["receiverBoundKind"] = "loop"
            add_node(node)
            add_edge(thread_id, terminal_id, edge_kind, call_id)
            emit_container_chain(file_path, ir, call_id, terminal_id, call_line)
            placed.append((terminal_id, call_line, call_id))

        flow_scopes.append((file_path, fn_id, thread_id, placed))
        return thread_id

    seed_thread_id = visit(seed_file, seed_id, role="seed")

    # Seed's return-shape terminals — one synthetic node per `return` inside
    # the seed function body. PLAN.md S1.3: "return shape rendered as a
    # terminal node." M17.2 reparents returns inside try/while into the
    # container (so a parentId==seed_id check would miss them); prefix-match
    # finds returns at any depth inside the seed, then emit_container_chain
    # nests each terminal inside its enclosing containers.
    seed_returns = [n for n in seed_ir.get("nodes", [])
                    if n.get("type") == "return_stmt"
                    and n["id"].startswith(seed_id + "/")]
    # M-FLOW.1 — every id in a file starts with "module/", so the prefix
    # would claim every function's returns for a module seed; only a
    # return that EXECUTES at top level belongs to it (in practice none).
    if seed_id == MODULE_SEED:
        top_ids = {n["id"] for n in module_descendants(seed_ir)}
        seed_returns = [n for n in seed_returns if n["id"] in top_ids]
    # §5.6a — the seed's placed call sites, for execution-order return
    # sourcing (the M24 flow pass stashed them per scope).
    seed_placed = next((ps for (fp, fid, _tid, ps) in flow_scopes
                        if fp == seed_file and fid == seed_id), [])
    for i, ret in enumerate(seed_returns):
        terminal_id = f"{seed_thread_id}:return@{i}"
        add_node({
            "id": terminal_id,
            "kind": "return",
            "label": "return",
            "file": seed_file,
            "irNodeId": ret["id"],
            "preview": ret.get("value"),
        })
        # §5.6a — a return joins the node that actually ran before it (the
        # last call in its scope, or the enclosing band that always runs),
        # not the bare function head. Reads as "after this, the function
        # returns".
        # M-NEST L1.5: if the return VALUE is itself a call, it was placed as a
        # step on this same statement (same line + same irNodeId, which
        # find_predecessor deliberately skips). Source the return terminal
        # directly from that step so the path reads `… → fc → return`.
        pred_from_call = next(
            (nid for (nid, _ln, cid) in seed_placed if cid == ret["id"]), None)
        pred_id = pred_from_call or find_predecessor(
            seed_file, seed_ir, seed_placed,
            ret.get("line", 0), ret["id"], seed_thread_id)
        add_edge(pred_id, terminal_id, "direct", ret["id"])
        emit_container_chain(seed_file, seed_ir, ret["id"], terminal_id, ret.get("line", 0))

    # M24 — deferred so return-only containers (emitted just above)
    # participate in joins and forks.
    emit_flow_edges()

    return {
        "version": "1.0",
        "seed": {
            "file": seed_file,
            "irNodeId": seed_id,
            "qualifiedName": seed_thread_id,
        },
        "nodes": nodes,
        "edges": edges,
    }


# ─────────────────────────────────────────── CLI ─────────────────────

def _files_reached(thread):
    """DFS the thread's nodes for distinct file paths. Skips terminals
    (external/dynamic) which carry file=None."""
    out = []
    seen = set()
    for n in thread.get("nodes", []):
        f = n.get("file")
        if not f or f in seen:
            continue
        seen.add(f)
        out.append(f)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="VibeGraph thread extractor.")
    ap.add_argument("--seed-file",
                    help="Project-relative file path of the seed function. Single-thread mode.")
    ap.add_argument("--seed-id",
                    help="IR node id of the seed function_def. Single-thread mode.")
    ap.add_argument("--batch-seeds", action="store_true",
                    help="Batch mode: read {files, seeds:[{seedFile, seedId, entryPointId?}]} "
                         "from stdin; emit {threads:[{...thread, entryPointId, filesReached}]}. "
                         "Pays libcst-free Python startup cost once per project parse instead "
                         "of once per entry point (M8.3.1).")
    args = ap.parse_args()
    payload = json.loads(sys.stdin.read())
    if args.batch_seeds:
        project = payload.get("files") or {}
        threads_out = []
        for s in payload.get("seeds", []):
            sf, sid = s.get("seedFile"), s.get("seedId")
            ep = s.get("entryPointId")
            if not sf or not sid or sf not in project:
                continue
            try:
                t = extract(project, sf, sid)
            except Exception as e:
                # Skip seeds that fail (e.g. seed function deleted from
                # disk between discovery and extraction). The envelope
                # still ships with whatever did extract cleanly.
                sys.stderr.write(f"extract failed for {sf}:{sid}: {e}\n")
                continue
            t["entryPointId"] = ep
            t["filesReached"] = _files_reached(t)
            threads_out.append(t)
        print(json.dumps({"threads": threads_out}, indent=2))
    else:
        if not args.seed_file or not args.seed_id:
            ap.error("--seed-file and --seed-id are required in single-thread mode")
        project = payload.get("files") or payload
        thread = extract(project, args.seed_file, args.seed_id)
        print(json.dumps(thread, indent=2))
