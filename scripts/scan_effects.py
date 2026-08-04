#!/usr/bin/env python3
"""
Authoritative server-side effect scan for "run to this node" (M-RUN SM3 floor).

THE SAFETY FLOOR. Before the runtime probe harness (server.ts
runThreadToNodeCore) executes any user code, the server asks THIS script
"is the static path from the entry function up to node N confidently
pure?". The verdict is re-derived here from the project IR — the server
does NOT trust the webview's client-side purity pre-gate (runToNode.ts),
which is now advisory UX only. SM2 (input synthesis) will widen what
executes; this floor must refuse any synthesized path that could reach a
side effect, so it lands first.

Why this must be interprocedural (the real gap, bigger than client-trust)
─────────────────────────────────────────────────────────────────────────
`effectKind` is tagged PER CALL SITE by parse_cst.py (string-match, not
transitive). A call to a local helper that itself does `open(...)` carries
NO effectKind at the call site — only the `open` inside the helper does.
The client pre-gate scans only the enclosing function's own nodes, so a
pure-LOOKING helper hiding an effect passes it today. An authoritative
scan therefore has to FOLLOW resolved calls and check effectKind in every
reachable body.

Conservative / over-approximate by construction (branch-reachability is
deferred to a later milestone): we OVER-refuse, never UNDER-refuse.
  - Top frame: a node is "may-run-before-N" if its line <= N's line OR it
    shares a loop ancestor with N (prior loop iterations run code that is
    textually after N). Everything else in the top frame is excluded
    (the probe raises _VGStop right after N, so trailing code never runs).
  - Any function reached from an in-scope call is scanned IN FULL — we do
    not track which branch/iteration actually calls it.
  - REFUSE (pure:false) on ANY of: a reached node carrying `effectKind`;
    a reached `dynamic` call (genuine runtime dispatch — purity
    unprovable); a reached `unresolved` call (resolution gap — can't
    prove purity); cycles are re-linked (memoized), not an offense.

Resolution is DUPLICATED from extract_thread.py (resolve_same_file,
classify_unresolved, the cross-file reference-edge lookup, the call-site
shapes, the local-binding computation) on purpose. The extractor needs
FAITHFUL semantics; this scanner needs OVER-APPROXIMATE semantics — there
is no clean shared abstraction at two consumers, and refactoring the
most-depended-upon tested code mid-safety-feature is the wrong risk.
  CONSOLIDATION TRIGGER: when a THIRD consumer of call resolution appears,
  hoist resolve_same_file + classify_unresolved + the reference-edge
  lookup into a shared scripts/lib/resolve.py and import it in all three.
The drift guard until then is test/scan_effects.test.mjs's RESOLUTION
PARITY test: this script and extract_thread.py must resolve the same
fixture to the same targets (parity on resolution; divergence allowed
only on the effect-verdict layer this script adds).

Pipeline:
  stdin  : {"files": {filePath: IR, ...}}            -- the linked project IR
  argv   : --stop-file main.py --stop-id "main/x.assign@3"   (server path)
           [seed = N's enclosing module-level function, derived here]
        OR --seed-file main.py --seed-id "main/f.fn"         (parity/whole-fn)
           [no stop bound: scan the whole function]
           --emit-resolution                                 (parity debug)
  stdout : verdict JSON (see SCHEMA below)
"""

import argparse
import json
import sys
from typing import Dict, List, Optional, Set, Tuple

# ── classification tables (DUPLICATED from extract_thread.py — see header) ──
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
DYNAMIC_BUILTINS = frozenset({"getattr", "setattr", "hasattr", "delattr"})
LOOP_TYPES = frozenset({"for_loop", "while_loop"})


# ── helpers (DUPLICATED from extract_thread.py) ───────────────────────────
def find_node(ir: dict, node_id: str) -> Optional[dict]:
    for n in ir.get("nodes", []):
        if n["id"] == node_id:
            return n
    return None


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


def resolve_same_file(ir: dict, call_target: str) -> Optional[str]:
    """Top-level function_def in `ir` named `call_target`. Same-file calls
    have no reference edge (the linker only emits cross-file edges)."""
    if "." in call_target:
        return None
    for n in ir.get("nodes", []):
        if n.get("type") == "function_def" and n.get("name") == call_target:
            if n.get("parentId") in (None, ""):
                return n["id"]
    return None


def classify_unresolved(call_target: str, is_local: bool) -> str:
    """Map an unresolvable callTarget to external | dynamic | unresolved.
    `is_local` = HEAD of the target is a local binding in the enclosing fn."""
    if "." in call_target:
        return "dynamic" if is_local else "external"
    if call_target in DYNAMIC_BUILTINS:
        return "dynamic"
    if call_target in KNOWN_BUILTINS:
        return "external"
    if is_local:
        return "dynamic"
    return "unresolved"


# ── seed derivation ───────────────────────────────────────────────────────
def enclosing_module_function(ir: dict, node_id: str) -> Optional[str]:
    """Walk parentId up from node_id to the nearest module-level (parentId
    None/'') function_def. Mirrors planRunToNode's enclosing-fn walk, but
    server-side and authoritative. Returns the function_def node id."""
    by_id = {n["id"]: n for n in ir.get("nodes", [])}
    cur = by_id.get(node_id)
    seen: Set[str] = set()
    while cur and cur.get("parentId") and cur["id"] not in seen:
        seen.add(cur["id"])
        parent = by_id.get(cur["parentId"])
        if parent and parent.get("type") == "function_def":
            return parent["id"]
        cur = parent
    return None


def loop_ancestor_ids(ir: dict, node_id: str) -> Set[str]:
    """ids of for_loop / while_loop nodes that enclose node_id. A node that
    shares one of these with N may run in a prior iteration even if it is
    textually after N — so it is in scope for the top-frame bound."""
    by_id = {n["id"]: n for n in ir.get("nodes", [])}
    out: Set[str] = set()
    cur = by_id.get(node_id)
    seen: Set[str] = set()
    while cur and cur.get("parentId") and cur["id"] not in seen:
        seen.add(cur["id"])
        parent = by_id.get(cur["parentId"])
        if parent and parent.get("type") in LOOP_TYPES:
            out.add(parent["id"])
        cur = parent
    return out


# ── call-site collection (DUPLICATED from extract_thread.py) ──────────────
def collect_call_sites(subtree: List[dict]) -> List[dict]:
    sites: List[dict] = []
    for n in subtree:
        t = n.get("type")
        if t == "assignment" and n.get("valueKind") == "call":
            sites.append({"id": n["id"], "callTarget": n.get("callTarget") or "<unknown>",
                          "line": n.get("line", 0)})
        elif t == "call":
            sites.append({"id": n["id"], "callTarget": n.get("funcName") or "<unknown>",
                          "line": n.get("line", 0)})
        elif t in ("return_stmt", "raise_stmt") and n.get("callTarget"):
            sites.append({"id": n["id"], "callTarget": n.get("callTarget"),
                          "line": n.get("line", 0)})
    sites.sort(key=lambda s: s["id"])
    return sites


def local_binding_names(fn: dict, subtree: List[dict]) -> Set[str]:
    """Names bound locally in this function: assignments + params + for-loop
    targets. A bare callTarget whose head is in this set is genuine runtime
    dispatch (dynamic), not a resolution gap."""
    assign = {n.get("name") for n in subtree
              if n.get("type") == "assignment" and n.get("name")}
    params = {p.split("=", 1)[0].strip() for p in (fn.get("params") or [])
              if p and p.split("=", 1)[0].strip()}
    loop_targets = {name.strip("() ")
                    for n in subtree if n.get("type") == "for_loop"
                    for name in (n.get("target") or "").split(",")
                    if name.strip("() ") and name.strip("() ") != "?"}
    return {x for x in (assign | params | loop_targets) if x}


# ── the scan ──────────────────────────────────────────────────────────────
class Scan:
    def __init__(self, project_ir: Dict[str, dict], emit_resolution: bool,
                 stop_on_offense: bool = True):
        self.project_ir = project_ir
        self.emit_resolution = emit_resolution
        # stop_on_offense=False powers --resolution-only: walk the WHOLE
        # reachable graph (like extract_thread.py) and record every call-site
        # resolution, instead of short-circuiting at the first offense. Only
        # the resolution-PARITY test uses this; the gate always short-circuits.
        self.stop_on_offense = stop_on_offense
        self.visited: Set[Tuple[str, str]] = set()
        self.resolution: List[dict] = []  # parity record (per call site)
        self.offenses: List[dict] = []     # SM3: every effect/dynamic/unresolved found

    def _record(self, file_path: str, call_id: str, target: str, kind: str,
                resolved_file: Optional[str] = None, resolved_id: Optional[str] = None):
        if not self.emit_resolution:
            return
        entry = {"file": file_path, "callId": call_id, "callTarget": target, "kind": kind}
        if kind == "step":
            entry["targetFile"] = resolved_file
            entry["targetId"] = resolved_id
        self.resolution.append(entry)

    def visit(self, file_path: str, fn_id: str,
              stop_id: Optional[str], stop_line: Optional[int]) -> Optional[dict]:
        """Returns the first offense dict, or None if this subtree is pure.
        stop_id/stop_line bound ONLY the top frame (passed None on recursion)."""
        key = (file_path, fn_id)
        if key in self.visited:
            return None  # cycle / re-link — not an offense (memoized)
        self.visited.add(key)
        ir = self.project_ir.get(file_path)
        if ir is None:
            # Reached a function whose file is not in the project IR. Cannot
            # prove purity → refuse conservatively.
            off = {"kind": "unresolved", "target": fn_id, "effectKind": None,
                   "file": file_path, "line": 0,
                   "reason": f"function in file not in project IR: {file_path}"}
            self.offenses.append(off)
            return off if self.stop_on_offense else None
        fn = find_node(ir, fn_id) or {}
        subtree = descendants(ir, fn_id)

        top_frame = stop_id is not None
        loop_anc = loop_ancestor_ids(ir, stop_id) if top_frame else set()

        def in_scope(node: dict) -> bool:
            if not top_frame:
                return True
            if (node.get("line") or 0) <= (stop_line or 0):
                return True
            return any(node["id"].startswith(a + "/") for a in loop_anc)

        # 1. Effect scan: any in-scope node carrying effectKind is a side
        #    effect on the path (open / cursor.execute / requests.get / ...).
        #    Always recorded (SM3 needs the full list for informed consent);
        #    the gate (stop_on_offense) returns the first, deterministic by id.
        for n in sorted((m for m in subtree if in_scope(m)), key=lambda m: m["id"]):
            ek = n.get("effectKind")
            if ek:
                off = {"kind": "effect", "target": n.get("callTarget") or n.get("funcName") or n["id"],
                       "effectKind": ek, "file": file_path, "line": n.get("line", 0),
                       "reason": f"side effect ({ek}) at {file_path}:{n.get('line', 0)}"}
                self.offenses.append(off)
                if self.stop_on_offense:
                    return off

        # 2. Call resolution: recurse into resolved project functions; refuse
        #    on dynamic / unresolved (purity unprovable through them).
        ref_by_source: Dict[str, dict] = {}
        for e in ir.get("edges", []):
            if e.get("type") == "reference":
                ref_by_source.setdefault(e["source"], e)

        local_names = local_binding_names(fn, subtree)
        node_by_id = {n["id"]: n for n in subtree}
        for site in collect_call_sites(subtree):
            if not in_scope({"id": site["id"], "line": site["line"]}):
                continue
            call_id, target = site["id"], site["callTarget"]
            ref = ref_by_source.get(call_id)
            if ref is not None:
                if ref.get("viaLocal"):
                    # method on a local receiver; external boundary. Any
                    # effectKind on this call node was caught in step 1.
                    self._record(file_path, call_id, target, "viaLocal-external")
                    # §5.5 floor safety: a receiver resolved through one-hop
                    # return-type inference (viaReturnType) is a method on an
                    # INFERRED external type — we cannot scan the library body
                    # to prove it pure, and step 1's parse-time effectKind
                    # heuristic is receiver-NAME based, so it misses
                    # non-conventional names (`c.execute` ≠ `conn.execute`).
                    # If step 1 didn't already flag an effect here, refuse
                    # conservatively rather than auto-allow — never loosen the
                    # floor that the §5.5 resolution would otherwise widen.
                    if ref.get("viaReturnType") and not node_by_id.get(call_id, {}).get("effectKind"):
                        off = {"kind": "external-unprovable", "target": target,
                               "effectKind": None, "file": file_path,
                               "line": site["line"],
                               "reason": f"return-type-inferred receiver '{target}' at "
                                         f"{file_path}:{site['line']} — external method "
                                         f"purity unprovable (§5.5 floor)"}
                        self.offenses.append(off)
                        if self.stop_on_offense:
                            return off
                    continue
                target_file = ref.get("targetFile") or file_path
                if target_file in self.project_ir:
                    self._record(file_path, call_id, target, "step", target_file, ref["target"])
                    off = self.visit(target_file, ref["target"], None, None)
                    if off and self.stop_on_offense:
                        return off
                    continue
                # A reference edge whose targetFile is not a key of the given
                # map is a FEED inconsistency (cross_file_link only links
                # inside the map it was handed — e.g. absolute targetFile in a
                # relative-keyed map). The callee's body is unscannable, so
                # refuse: silently calling it "external" would let the whole
                # cross-file leg of the path bypass the floor.
                self._record(file_path, call_id, target, "unresolved")
                off = {"kind": "unresolved", "target": target, "effectKind": None,
                       "file": file_path, "line": site["line"],
                       "reason": f"resolved call '{target}' at {file_path}:{site['line']} "
                                 f"targets '{target_file}' which is not in the scanned "
                                 f"project map — purity unprovable"}
                self.offenses.append(off)
                if self.stop_on_offense:
                    return off
                continue

            local_id = resolve_same_file(ir, target)
            if local_id is not None:
                self._record(file_path, call_id, target, "step", file_path, local_id)
                off = self.visit(file_path, local_id, None, None)
                if off and self.stop_on_offense:
                    return off
                continue

            head = target.split(".", 1)[0]
            kind = classify_unresolved(target, head in local_names)
            self._record(file_path, call_id, target, kind)
            if kind in ("dynamic", "unresolved"):
                off = {"kind": kind, "target": target, "effectKind": None,
                       "file": file_path, "line": site["line"],
                       "reason": f"{kind} call '{target}' at {file_path}:{site['line']} "
                                 f"— purity unprovable"}
                self.offenses.append(off)
                if self.stop_on_offense:
                    return off
            # external pure builtin (len, math.sqrt, ...) — allowed, no recurse.
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Authoritative effect scan for run-to-node.")
    ap.add_argument("--stop-file")
    ap.add_argument("--stop-id")
    ap.add_argument("--seed-file")
    ap.add_argument("--seed-id")
    ap.add_argument("--emit-resolution", action="store_true")
    ap.add_argument("--resolution-only", action="store_true",
                    help="Walk the whole reachable graph (no refusal short-circuit) "
                         "and emit only the resolution map — for the parity test.")
    ap.add_argument("--list-effects", action="store_true",
                    help="SM3: walk the whole path and emit EVERY offense "
                         "{kind,effectKind,target,file,line} for informed consent, "
                         "instead of short-circuiting at the first.")
    args = ap.parse_args()

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"pure": False, "reason": f"bad IR JSON: {e}",
                          "offending": None}))
        return
    # Accept both {"files": {...}} (server wire format) and a bare files-map
    # (committed *.ir.json fixtures) — matches extract_thread.py's leniency.
    project_ir = payload.get("files") if isinstance(payload, dict) and "files" in payload else payload

    # Two entry modes. stop-mode (server path): derive the enclosing
    # module-level function of N and scan bounded by N. seed-mode
    # (parity/whole-fn): scan the whole given function, unbounded.
    if args.stop_file and args.stop_id:
        seed_file = args.stop_file
        ir = project_ir.get(seed_file)
        if ir is None:
            print(json.dumps({"pure": False,
                              "reason": f"stop file not in project IR: {seed_file}",
                              "offending": None}))
            return
        stop_node = find_node(ir, args.stop_id)
        if stop_node is None:
            print(json.dumps({"pure": False,
                              "reason": f"stop id not in {seed_file}: {args.stop_id}",
                              "offending": None}))
            return
        seed_id = enclosing_module_function(ir, args.stop_id)
        if seed_id is None:
            print(json.dumps({"pure": False,
                              "reason": "node is not inside a module-level function",
                              "offending": None}))
            return
        stop_id: Optional[str] = args.stop_id
        stop_line: Optional[int] = stop_node.get("line", 0)
    elif args.seed_file and args.seed_id:
        seed_file, seed_id = args.seed_file, args.seed_id
        if project_ir.get(seed_file) is None or find_node(project_ir[seed_file], seed_id) is None:
            print(json.dumps({"pure": False,
                              "reason": f"seed not found: {args.seed_file}:{args.seed_id}",
                              "offending": None}))
            return
        stop_id, stop_line = None, None
    else:
        ap.error("need either --stop-file/--stop-id or --seed-file/--seed-id")
        return

    if args.resolution_only:
        scan = Scan(project_ir, emit_resolution=True, stop_on_offense=False)
        scan.visit(seed_file, seed_id, stop_id, stop_line)
        print(json.dumps({"resolution": scan.resolution}))
        return

    if args.list_effects:
        scan = Scan(project_ir, emit_resolution=False, stop_on_offense=False)
        scan.visit(seed_file, seed_id, stop_id, stop_line)
        # Canonical order so the consent token over this set is stable
        # regardless of walk order (server HMACs the serialized list).
        offenses = sorted(scan.offenses, key=lambda o: (
            o["file"], o.get("line") or 0, o["kind"], o.get("effectKind") or "", o["target"]))
        print(json.dumps({
            "pure": len(offenses) == 0,
            "offenses": [{k: o.get(k) for k in ("kind", "effectKind", "target", "file", "line")} for o in offenses],
            "seed": {"file": seed_file, "id": seed_id},
            "stop": None if stop_id is None else {"file": seed_file, "id": stop_id, "line": stop_line},
        }))
        return

    scan = Scan(project_ir, args.emit_resolution)
    offense = scan.visit(seed_file, seed_id, stop_id, stop_line)
    out = {
        "pure": offense is None,
        "reason": "confidently pure path" if offense is None else offense["reason"],
        "offending": None if offense is None else {
            k: offense[k] for k in ("kind", "target", "effectKind", "file", "line")
        },
        "seed": {"file": seed_file, "id": seed_id},
        "stop": None if stop_id is None else {"file": seed_file, "id": stop_id, "line": stop_line},
    }
    if args.emit_resolution:
        out["resolution"] = scan.resolution
    print(json.dumps(out))


if __name__ == "__main__":
    main()
