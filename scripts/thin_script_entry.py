"""Thin scripts as entry points (2026-10-07, field report).

The standard shape of a console script — `from pkg.cli import main` then
`if __name__ == "__main__": sys.exit(main())` — defines no `main` of its
own, and discover_entry_points.detect_cli knew only the file's own defs: the
script produced no entry point, no thread, no contract and no tests. These
helpers follow the `__main__` call through the LINKER's cross-file edge (the
same resolution every thread uses — nothing re-implemented here) and, when
it resolves to nothing, keep the script as a module-seeded entry that says
which name it could not find.
"""
import builtins
import sys
from pathlib import Path

_BUILTINS = set(dir(builtins))
_STDLIB = set(getattr(sys, "stdlib_module_names", ()))


def imported_heads(ir):
    """Local name -> module, for every name an import binds in this file."""
    out = {}
    for n in ir["nodes"]:
        if n["type"] == "import_from":
            for nm in n.get("names", []):
                out[nm.split(" as ")[-1].strip()] = n.get("module", "")
        elif n["type"] == "import":
            for nm in n.get("names", []) or [n.get("module", "")]:
                local = nm.split(" as ")[-1].strip().split(".")[0]
                if local:
                    out[local] = nm.split(" as ")[0].strip()
    return out


def linked_def(c, ir, all_files):
    """(file, function_def) a call in this file was LINKED to in another
    file (cross_file_link's reference edge), or None."""
    if not all_files:
        return None
    for e in ir.get("edges", []):
        if e.get("source") != c["id"] or e.get("type") != "reference" or not e.get("targetFile"):
            continue
        other = all_files.get(e["targetFile"])
        if not other:
            continue
        fn = next((n for n in other["nodes"] if n["id"] == e["target"] and n["type"] == "function_def"), None)
        if fn:
            return e["targetFile"], fn
    return None


def could_be_program(target, imported):
    """A call in a `__main__` block that could be the program: a bare name
    that is not a builtin, or a call on an imported non-stdlib module."""
    head = target.split(".")[0]
    if "." not in target:
        return head not in _BUILTINS
    mod = imported.get(head)
    return mod is not None and mod.split(".")[0] not in _STDLIB


def add_thin_entry(seen, script, def_file, fn, make_entry):
    """Seed at the function the script runs; `runBy` lists every script
    that runs it."""
    key = (def_file, fn["id"])
    if key not in seen:
        e = make_entry(def_file, fn, kind="cli")
        e["qualifiedName"] = f"{Path(script).stem}:{fn['name']}"
        e["label"] = Path(script).name
        e["summary"] = f"{Path(script).name} runs {fn['name']} from {def_file}"
        e["metadata"] = {"runBy": [script]}
        seen[key] = e
    elif script not in seen[key].setdefault("metadata", {}).setdefault("runBy", []):
        seen[key]["metadata"]["runBy"].append(script)


def unresolved_entry(script, names):
    """The script as a module-seeded entry that says what it could not find."""
    names = list(dict.fromkeys(names))
    quoted = ", ".join(f"'{u}'" for u in names)
    return {
        "id": f"{script}:module", "kind": "cli", "file": script, "irNodeId": "module",
        "qualifiedName": f"{Path(script).stem}:module", "label": Path(script).name,
        "summary": f"entry calls {quoted}, not defined in this file and not linked; unresolved",
        "framework": None,
        "metadata": {"seed": "module", "unresolved": names},
    }
