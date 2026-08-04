#!/usr/bin/env python3
"""
Cross-file symbol resolution for VibeGraph project mode (M4a).

Pure JSON post-processor — does NOT re-parse source. Consumes per-file IRs
already emitted by parse_cst.py (which records imports as `import` /
`import_from` nodes with `module` and `names` fields), and enriches each
file's edge list with cross-file `reference` edges.

Pipeline:
  stdin  : {"files": {filePath: IR, ...}}
  stdout : {"files": {filePath: enriched_IR, ...}}

Each enriched IR keeps the same shape but its `edges` array gains entries
with the v1.1 `targetFile` and `qualifiedTarget` fields when the source
node references a symbol resolvable to another file's IR.

Resolution per PLAN.md §1.5 M4a:

  - Imports: `import X`, `import X as Y`, `import X.Y`, `from X import Y`,
    `from X import Y as Z`, relative imports (`from . import X`,
    `from .sib import Y`) — all mapped per-file to a {name_in_scope:
    qualified_target} import_map.

  - Calls considered: top-level `call` nodes (parser emits one per
    statement-level call expression) AND assignment nodes whose
    `valueKind == 'call'` (v1.1 `callTarget` field). Class-base
    references are also resolved.

  - Stop conditions (emit no edge): getattr, computed attribute access,
    third-party callees (anything not in the project's modulePath set),
    or any callee that cannot be resolved against the project's
    qualified-symbol index. Never crashes; just skips.
"""
import json
import os
import sys
from typing import Dict, List, NamedTuple, Optional, Tuple

# A qualified symbol path: "<modulePath>:<name>" for module-level, or
# "<modulePath>:<class>.<method>" for class methods. The ':' separator is
# load-bearing — see PLAN.md §1.5 M4a.
QualifiedPath = str


class ResolveResult(NamedTuple):
    """Outcome of resolving a callee expression to a qualified path.

    `qualified` is the resolved symbol path (e.g. ``"argparse:ArgumentParser.
    add_subparsers"`` or ``"models:User"``). `via_local` and
    `local_assignment_id` are non-None when resolution went through a
    local-variable receiver in the calling scope (e.g. ``parser.method()``
    where ``parser = argparse.ArgumentParser(...)``) — see PLAN-v3-revised §D.
    `via_return_type` is True only for the §5.5 one-hop path (receiver
    resolved through its binding callee's RETURN annotation, not a direct
    class instantiation) — the run-to-node floor reads it to refuse
    conservatively, since the external method's purity is unprovable.
    """
    qualified: QualifiedPath
    via_local: Optional[str] = None
    local_assignment_id: Optional[str] = None
    via_return_type: bool = False


# ─────────────────────────────────────────── module-path helpers ─────

def file_to_module_path(file_path: str, project_root: str) -> str:
    """Convert an absolute file path under project_root to a dotted module name.

    /root/main.py             -> "main"
    /root/pkg/sub/util.py     -> "pkg.sub.util"
    /root/pkg/__init__.py     -> "pkg"
    """
    rel = os.path.relpath(file_path, project_root)
    parts = rel.split(os.sep)
    if parts[-1] == "__init__.py":
        parts = parts[:-1]
    elif parts[-1].endswith(".py"):
        parts[-1] = parts[-1][:-3]
    return ".".join(p for p in parts if p)


# ─────────────────────────────────────────── import map ──────────────

def parse_import_node(node: dict) -> List[Tuple[str, str]]:
    """`import X` / `import X as Y` / `import X.Y` / `import X.Y as Z`.
    Returns [(name_in_scope, target_module_dotted)] entries."""
    out: List[Tuple[str, str]] = []
    for entry in node.get("names", []):
        # `entry` is a string like "x", "x as y", "x.y", "x.y as z".
        if " as " in entry:
            target, alias = (s.strip() for s in entry.split(" as ", 1))
            out.append((alias, target))
        else:
            target = entry.strip()
            # `import x.y` binds `x` in the local namespace, not `x.y`.
            head = target.split(".", 1)[0]
            out.append((head, target))
    return out


def parse_import_from_node(node: dict, file_module: str) -> List[Tuple[str, str]]:
    """`from X import Y` / `from X import Y as Z` / `from . import Y` /
    `from .sib import Y` / `from ..pkg.sub import Y`.

    Returns [(name_in_scope, "X:Y" qualified_target)] entries.

    Relative imports are resolved against the importing file's dotted
    package (file_module minus its last segment). `file_module` is
    the importing file's modulePath; for a package __init__, callers
    pass the package itself.
    """
    raw_module = node.get("module", "") or ""
    # libcst's `code_for_node` may yield e.g. ".sib" for `from .sib import X`
    # because the relative dots ARE part of the module attribute when
    # node.relative is non-empty. Strip leading dots and count them to
    # determine relativity.
    dot_count = 0
    bare = raw_module
    while bare.startswith("."):
        dot_count += 1
        bare = bare[1:]

    if dot_count > 0:
        # Resolve relative: file_module is e.g. "pkg.sub.mod"; package is
        # everything up to but not including the leaf. `from .X` resolves
        # against the package; `from ..X` walks one level up; etc.
        pkg_parts = file_module.split(".")[:-1]  # drop module leaf
        # First dot means "same package", so use len-(dot_count-1) parts.
        if dot_count - 1 > 0:
            if dot_count - 1 > len(pkg_parts):
                # Walks above project root — unresolvable.
                return []
            pkg_parts = pkg_parts[: -(dot_count - 1)]
        target_module = ".".join(filter(None, pkg_parts + ([bare] if bare else [])))
    else:
        target_module = bare

    if not target_module:
        return []

    out: List[Tuple[str, str]] = []
    for entry in node.get("names", []):
        if " as " in entry:
            name, alias = (s.strip() for s in entry.split(" as ", 1))
            out.append((alias, f"{target_module}:{name}"))
        else:
            name = entry.strip()
            out.append((name, f"{target_module}:{name}"))
    return out


def build_import_map(ir: dict, file_module: str) -> Dict[str, str]:
    """Walk a file's IR import nodes and produce {name_in_scope: target}.

    - For `from X import Y`, target is the qualified `"X:Y"`.
    - For `import X`, target is the dotted module `"X"` (no colon).
    The distinction matters at resolution time — `"X:Y"` resolves directly
    against the project symbol index; `"X"` requires an attribute access
    (`X.Y(...)`) and is only resolvable when X is itself a project module.
    """
    import_map: Dict[str, str] = {}
    for node in ir.get("nodes", []):
        ntype = node.get("type")
        if ntype == "import":
            for alias, target in parse_import_node(node):
                import_map[alias] = target  # e.g. "os" or "os.path"
        elif ntype == "import_from":
            for alias, target in parse_import_from_node(node, file_module):
                import_map[alias] = target  # e.g. "utils:greet"
    return import_map


# ─────────────────────────────────────────── project symbol index ────

def build_project_symbols(
    files: Dict[str, dict],
    module_paths: Dict[str, str],
) -> Dict[QualifiedPath, Tuple[str, str]]:
    """Project-wide qualified-name → (filePath, nodeId).

    Module-level functions  : "<module>:<name>"           → (file, fn_node_id)
    Module-level classes    : "<module>:<name>"           → (file, class_node_id)
    Class methods           : "<module>:<class>.<method>" → (file, method_node_id)

    Module-level constants are NOT indexed in M4a (they can't be called
    cross-file in a way our resolver would emit an edge for today).
    """
    out: Dict[QualifiedPath, Tuple[str, str]] = {}
    # Build a {node_id -> node} lookup per file for class-method parent walks.
    for file_path, ir in files.items():
        modpath = module_paths.get(file_path)
        if not modpath:
            continue
        nodes_by_id = {n["id"]: n for n in ir.get("nodes", [])}
        for node in ir.get("nodes", []):
            ntype = node.get("type")
            if ntype == "function_def":
                name = node.get("name")
                if not name:
                    continue
                parent_id = node.get("parentId")
                if parent_id and parent_id in nodes_by_id and nodes_by_id[parent_id].get("type") == "class_def":
                    cls_name = nodes_by_id[parent_id].get("name")
                    if cls_name:
                        out[f"{modpath}:{cls_name}.{name}"] = (file_path, node["id"])
                else:
                    out[f"{modpath}:{name}"] = (file_path, node["id"])
            elif ntype == "class_def":
                name = node.get("name")
                if name:
                    out[f"{modpath}:{name}"] = (file_path, node["id"])
    return out


def build_function_return_types(
    files: Dict[str, dict],
    module_paths: Dict[str, str],
) -> Dict[str, str]:
    """Project-wide {qualified_fn → resolved_return_qualified} for §5.5
    one-hop return-type inference.

    For every function carrying a `returns` annotation, resolve that
    annotation **against its OWN file's import map** (the return type lives
    in the callee's import context, not the caller's) and key it by the same
    qualified name `build_project_symbols` uses (`<module>:<fn>` or
    `<module>:<Class>.<method>`). Only entries whose annotation resolves to a
    qualified `module:Type` are kept — builtins like `dict`/`str` don't
    resolve and are dropped, so they never produce a misleading edge.

    Covers same-file AND cross-file binding callees uniformly: the caller's
    `build_local_bindings_for_scope` looks up the binding callee's resolved
    qualified in this map regardless of which file the callee lives in.
    """
    out: Dict[str, str] = {}
    for file_path, ir in files.items():
        modpath = module_paths.get(file_path)
        if not modpath:
            continue
        import_map = build_import_map(ir, modpath)
        nodes_by_id = {n["id"]: n for n in ir.get("nodes", [])}
        for node in ir.get("nodes", []):
            if node.get("type") != "function_def":
                continue
            ret_ann = node.get("returns")
            if not ret_ann:
                continue
            resolved_ret = resolve_callee_to_qualified(ret_ann, import_map)
            if not resolved_ret or ":" not in resolved_ret:
                continue
            name = node.get("name")
            if not name:
                continue
            parent_id = node.get("parentId")
            if (parent_id and parent_id in nodes_by_id
                    and nodes_by_id[parent_id].get("type") == "class_def"):
                cls_name = nodes_by_id[parent_id].get("name")
                if cls_name:
                    out[f"{modpath}:{cls_name}.{name}"] = resolved_ret
            else:
                out[f"{modpath}:{name}"] = resolved_ret
    return out


# ─────────────────────────────────────────── edge emission ───────────

def resolve_callee_to_qualified(
    callee: str,
    import_map: Dict[str, str],
) -> Optional[QualifiedPath]:
    """Map a callee expression (e.g. 'greet', 'models.User', 'models.User')
    to a qualified path via the import map alone. Returns None for:
    unknown bare names, attribute access on unknown receivers, `getattr`,
    calls into modules not surfaced by imports.

    For scope-aware resolution that also consults local-variable bindings
    (e.g. ``parser = argparse.ArgumentParser(...)`` → ``parser.method()``),
    use :func:`resolve_callee_with_locals` instead.
    """
    if not callee or callee == "?" or "()" in callee:
        # Computed call (e.g. fn()()), drop.
        return None
    # Strip surface noise from _func_name's output.
    parts = callee.split(".")
    head = parts[0]
    if head not in import_map:
        return None
    mapped = import_map[head]
    if ":" in mapped:
        # `from X import Y` form — head IS the imported symbol. Any further
        # attribute access on it (e.g. `Y.some_attr(...)`) is method access
        # on an instance/class, which we don't resolve in M4a.
        if len(parts) == 1:
            return mapped
        # Cls.method() where head is the class: rewrite to "<module>:Cls.method".
        if len(parts) == 2:
            module, sym = mapped.split(":", 1)
            return f"{module}:{sym}.{parts[1]}"
        return None
    # `import X` form — head IS the module. Attribute access becomes the
    # symbol. `import x.y` → mapped is "x.y" (the dotted module). If callee
    # is `x.y.do_thing(...)`, parts = ["x", "y", "do_thing"]; the module
    # is the prefix matching `mapped` and the trailing piece is the symbol.
    mapped_parts = mapped.split(".")
    if parts[: len(mapped_parts)] != mapped_parts:
        # The leading parts must match the dotted module to resolve.
        # `import x.y` then calling `x.y` directly: parts == ["x", "y"]
        # which matches; no trailing symbol = unresolvable.
        return None
    trailing = parts[len(mapped_parts):]
    if len(trailing) == 1:
        return f"{mapped}:{trailing[0]}"
    if len(trailing) == 2:
        return f"{mapped}:{trailing[0]}.{trailing[1]}"
    return None


def resolve_callee_with_locals(
    callee: str,
    import_map: Dict[str, str],
    local_bindings: Optional[Dict[str, dict]] = None,
) -> Optional[ResolveResult]:
    """Like :func:`resolve_callee_to_qualified` but also consults
    ``local_bindings`` — the per-scope map of {var_name → AssignmentInfo}
    built by :func:`build_local_bindings_for_scope`. Local bindings shadow
    imports in their scope (M17.1 / PLAN-v3-revised §D)."""
    if not callee or callee == "?" or "()" in callee:
        return None
    parts = callee.split(".")
    head = parts[0]

    # Local bindings take precedence over imports inside their scope, for
    # the 2-segment `local.method` form. Two binding shapes resolve:
    #
    #   - CapitalCase bound symbol — `parser = argparse.ArgumentParser()`
    #     (M17.1). The bound symbol IS the receiver type; resolve the
    #     method directly on it.
    #   - lowercase bound symbol with a return-type contract — §5.5
    #     one-hop inference: `conn = _get_conn()` where
    #     `def _get_conn() -> sqlite3.Connection:`. The callee isn't the
    #     type, but its return annotation names it; resolve the method on
    #     the returned type. This reverses M17.1's *blanket* lowercase
    #     skip, but ONLY on an explicit annotation — never a guess — so it
    #     still can't emit the `db:_get_conn.execute` misleading edge.
    #
    # Still excluded (fall through to honest dynamic/external):
    #   - 1-segment `local()` — factory-return value (`model = select(); model()`).
    #   - lowercase bound WITHOUT a return annotation — we never guess a type.
    if local_bindings and head in local_bindings and len(parts) == 2:
        binding = local_bindings[head]
        resolved = binding.get("resolved_qualified")
        if not resolved or ":" not in resolved:
            return None
        module, sym = resolved.split(":", 1)
        # PEP-8 heuristic: classes are CapitalCase, functions are
        # lowercase_with_underscores. Dotted sym like "pkg.Cls" — use
        # the last segment.
        sym_leaf = sym.rsplit(".", 1)[-1]
        if sym_leaf and sym_leaf[0].isupper():
            return ResolveResult(
                qualified=f"{module}:{sym}.{parts[1]}",
                via_local=head,
                local_assignment_id=binding["assignment_id"],
            )
        # §5.5: lowercase-bound receiver — one-hop return-type inference.
        ret = binding.get("resolved_return_qualified")
        if ret and ":" in ret:
            rmod, rsym = ret.split(":", 1)
            return ResolveResult(
                qualified=f"{rmod}:{rsym}.{parts[1]}",
                via_local=head,
                local_assignment_id=binding["assignment_id"],
                via_return_type=True,
            )
        return None
    # Three-segment chains (local.attr.method) are out of scope —
    # would require attribute-type tracking. See §D.5.
    if local_bindings and head in local_bindings and len(parts) >= 3:
        return None

    qpath = resolve_callee_to_qualified(callee, import_map)
    if qpath is None:
        return None
    return ResolveResult(qualified=qpath)


def _find_enclosing_function(
    node_id: str, nodes_by_id: Dict[str, dict]
) -> Optional[str]:
    """Walk parentId chain from ``node_id``; return the nearest
    function_def ancestor's id, or None if no function ancestor (module
    scope). Closure-aware — returns the innermost function."""
    node = nodes_by_id.get(node_id)
    if not node:
        return None
    parent_id = node.get("parentId")
    while parent_id:
        parent = nodes_by_id.get(parent_id)
        if not parent:
            return None
        if parent.get("type") == "function_def":
            return parent_id
        parent_id = parent.get("parentId")
    return None


def build_local_bindings_for_scope(
    ir: dict,
    scope_id: Optional[str],
    nodes_by_id: Dict[str, dict],
    import_map: Dict[str, str],
    existing_ref_edges_by_source: Dict[str, List[dict]],
    function_return_types: Optional[Dict[str, str]] = None,
) -> Dict[str, dict]:
    """Build the {var_name → AssignmentInfo} map for one scope.

    A binding is recorded for every assignment whose enclosing function is
    ``scope_id`` (or whose enclosing scope is module-level when
    ``scope_id`` is None), whose target is a plain identifier (not
    ``self.x``), and whose RHS is a direct call. The ``resolved_qualified``
    is determined by:

    1. Importing resolution against ``import_map`` (external libs like
       ``argparse.ArgumentParser``).
    2. Falling back to the assignment's existing same-file reference
       edges (parse_cst already emits these from its ``_defs`` table for
       top-level functions/classes) — handles
       ``cls_instance = LocalClass(...)`` patterns.

    ``resolved_return_qualified`` (§5.5) is the resolved return type of the
    binding callee, looked up in the project-wide ``function_return_types``
    map (``build_function_return_types``) — covers BOTH same-file and
    cross-file callees uniformly. Lets ``resolve_callee_with_locals``
    resolve a lowercase-bound receiver's methods against the returned type
    instead of refusing (annotation-driven, never guessed).

    Returns an empty dict when no bindings apply.
    """
    function_return_types = function_return_types or {}
    bindings: Dict[str, dict] = {}
    for node in ir.get("nodes", []):
        if node.get("type") != "assignment" or node.get("valueKind") != "call":
            continue
        if _find_enclosing_function(node["id"], nodes_by_id) != scope_id:
            continue
        name = node.get("name", "")
        if not name or "." in name:
            # Skip self.x = ..., obj.attr = ..., tuple targets, etc.
            continue
        call_target = node.get("callTarget", "")
        resolved = resolve_callee_to_qualified(call_target, import_map)
        if resolved is None:
            # Same-file fallback: look for an existing reference edge
            # from this assignment to a class_def or function_def.
            for edge in existing_ref_edges_by_source.get(node["id"], []):
                tgt = nodes_by_id.get(edge.get("target", ""))
                if tgt and tgt.get("type") in ("class_def", "function_def"):
                    resolved = edge.get("qualifiedTarget")
                    if not resolved:
                        modpath = ir.get("modulePath", "")
                        tgt_name = tgt.get("name", "")
                        if modpath and tgt_name:
                            resolved = f"{modpath}:{tgt_name}"
                    break
        # §5.5: one-hop return-type inference — same-file OR cross-file,
        # via the project-wide map keyed by the resolved callee qualified.
        return_qualified = (
            function_return_types.get(resolved) if resolved else None
        )
        bindings[name] = {
            "assignment_id": node["id"],
            "call_target": call_target,
            "resolved_qualified": resolved,
            "resolved_return_qualified": return_qualified,
        }
    return bindings


def emit_cross_file_edges(
    file_path: str,
    ir: dict,
    import_map: Dict[str, str],
    project_symbols: Dict[QualifiedPath, Tuple[str, str]],
    function_return_types: Optional[Dict[str, str]] = None,
) -> List[dict]:
    """Walk a file's nodes and return new ``reference`` edges with v1.1+
    ``targetFile`` / ``qualifiedTarget`` fields and v1.4+ ``viaLocal``
    fields. Existing edges are not duplicated — caller appends these to
    ``ir['edges']``.

    Two emission paths:

    - **Cross-file** — callee resolves through the import map to a symbol
      in another file's ``project_symbols`` entry. Edge target is the
      foreign node id; ``targetFile`` is the foreign path.
    - **Local-receiver (M17.1)** — callee's head is a local variable
      whose assignment can be traced to either an external library
      symbol or a same-file class/function. Edge target is the local
      assignment (intra-file); ``qualifiedTarget`` carries the resolved
      external/project symbol; ``viaLocal`` records the receiver name.
    """
    new_edges: List[dict] = []
    nodes_by_id: Dict[str, dict] = {n["id"]: n for n in ir.get("nodes", [])}

    # Existing reference edges grouped by source — consulted when
    # building local bindings for same-file class instantiations.
    existing_ref_edges_by_source: Dict[str, List[dict]] = {}
    for edge in ir.get("edges", []):
        if edge.get("type") == "reference":
            existing_ref_edges_by_source.setdefault(edge["source"], []).append(edge)

    # Pre-compute bindings per scope (module + each function_def id).
    scope_ids: List[Optional[str]] = [None]
    for node in ir.get("nodes", []):
        if node.get("type") == "function_def":
            scope_ids.append(node["id"])
    bindings_by_scope: Dict[Optional[str], Dict[str, dict]] = {}
    for sid in scope_ids:
        bindings_by_scope[sid] = build_local_bindings_for_scope(
            ir, sid, nodes_by_id, import_map, existing_ref_edges_by_source,
            function_return_types,
        )

    for node in ir.get("nodes", []):
        ntype = node.get("type")
        callee: Optional[str] = None
        if ntype == "call":
            callee = node.get("funcName")
        elif ntype == "assignment" and node.get("valueKind") == "call":
            callee = node.get("callTarget")
        elif ntype in ("return_stmt", "raise_stmt"):
            # `return Foo()` / `raise ProjectError(...)` carry a callTarget
            # exactly like a call node; without this branch an IMPORTED
            # callee in a return position resolved to nothing (the
            # same-file half of the gap is fixed in parse_cst._emit_local_ref).
            callee = node.get("callTarget")
        elif ntype == "class_def":
            # Class bases resolve at module scope (class declarations
            # are module-level in this codebase's IR).
            module_bindings = bindings_by_scope.get(None, {})
            for base in node.get("bases", []):
                result = resolve_callee_with_locals(
                    base, import_map, module_bindings
                )
                if not result:
                    continue
                if result.via_local and result.local_assignment_id:
                    # viaLocal edges are intra-file; per the schema,
                    # `targetFile` is absent for intra-file edges.
                    new_edges.append({
                        "source": node["id"],
                        "target": result.local_assignment_id,
                        "type": "reference",
                        "qualifiedTarget": result.qualified,
                        "viaLocal": result.via_local,
                    })
                elif result.qualified in project_symbols:
                    target_file, target_id = project_symbols[result.qualified]
                    if target_file != file_path:
                        new_edges.append({
                            "source": node["id"],
                            "target": target_id,
                            "type": "reference",
                            "targetFile": target_file,
                            "qualifiedTarget": result.qualified,
                        })
            continue
        if callee is None:
            continue

        scope_id = _find_enclosing_function(node["id"], nodes_by_id)
        bindings = bindings_by_scope.get(scope_id, {})
        # Don't let an assignment resolve through its own LHS binding
        # (would be a meaningless self-loop pre-execution).
        if ntype == "assignment":
            self_name = node.get("name", "")
            if self_name and "." not in self_name and self_name in bindings:
                bindings = {k: v for k, v in bindings.items() if k != self_name}

        result = resolve_callee_with_locals(callee, import_map, bindings)
        if not result:
            continue

        if result.via_local and result.local_assignment_id:
            # viaLocal edges are intra-file; per the schema, `targetFile`
            # is absent for intra-file edges.
            edge = {
                "source": node["id"],
                "target": result.local_assignment_id,
                "type": "reference",
                "qualifiedTarget": result.qualified,
                "viaLocal": result.via_local,
            }
            # §5.5 floor marker: resolved through one-hop return-type
            # inference (not a direct class instantiation). The
            # run-to-node effect scan reads this to refuse conservatively.
            if result.via_return_type:
                edge["viaReturnType"] = True
            new_edges.append(edge)
            continue

        if result.qualified not in project_symbols:
            continue
        target_file, target_id = project_symbols[result.qualified]
        if target_file == file_path:
            # Same-file reference; parse_cst.py already handled it via _defs.
            continue
        new_edges.append({
            "source": node["id"],
            "target": target_id,
            "type": "reference",
            "targetFile": target_file,
            "qualifiedTarget": result.qualified,
        })
    return new_edges


# ─────────────────────────────────────────── entry point ─────────────

def _ratchet_version(current: str, floor: str) -> str:
    """Return the higher of two dotted version strings. Never downgrades."""
    def parts(v: str) -> Tuple[int, ...]:
        return tuple(int(x) for x in v.split("."))
    try:
        return floor if parts(floor) > parts(current) else current
    except (ValueError, AttributeError):
        return floor


def link(files: Dict[str, dict]) -> Dict[str, dict]:
    """Take a {filePath: IR} mapping (each IR already has `modulePath` set
    by parse_cst.py --module-path), return the same shape with cross-file
    `reference` edges appended to each file's edges list.

    Idempotent (M26.1): linker-emitted edges are recognisable by their
    `qualifiedTarget` field (parser-native reference edges never carry
    it) and are stripped before re-emission, so an already-linked map
    can be re-linked — the incremental derived-refresh path feeds the
    in-memory (linked) project back through this pass after an edit."""
    module_paths: Dict[str, str] = {
        fp: ir.get("modulePath", "") for fp, ir in files.items()
    }
    project_symbols = build_project_symbols(files, module_paths)
    # §5.5: project-wide {qualified_fn → resolved return type}, so a binding
    # callee's return annotation resolves whether it's same-file or imported.
    function_return_types = build_function_return_types(files, module_paths)
    out: Dict[str, dict] = {}
    for file_path, ir in files.items():
        modpath = module_paths.get(file_path, "")
        import_map = build_import_map(ir, modpath)
        # Strip prior linker output FIRST so emit_cross_file_edges sees
        # the same edge view a fresh parse would give it (its same-file
        # fallback consults existing reference edges).
        prior_edges = [
            e for e in ir.get("edges", [])
            if not (e.get("type") == "reference" and "qualifiedTarget" in e)
        ]
        raw = dict(ir)
        raw["edges"] = prior_edges
        new_edges = emit_cross_file_edges(
            file_path, raw, import_map, project_symbols, function_return_types
        )
        enriched = dict(raw)
        enriched["edges"] = prior_edges + new_edges
        # Ratchet version up to reflect the highest-versioned field
        # added by this pass. Never downgrades the parser's emitted
        # version (which may already be ahead for other reasons).
        current = enriched.get("version", "1.0")
        if any("viaLocal" in e for e in new_edges):
            enriched["version"] = _ratchet_version(current, "1.4")
        elif new_edges:
            enriched["version"] = _ratchet_version(current, "1.1")
        out[file_path] = enriched
    return out


def main() -> None:
    payload = json.load(sys.stdin)
    files = payload.get("files", {})
    enriched = link(files)
    json.dump({"files": enriched}, sys.stdout)


if __name__ == "__main__":
    main()
