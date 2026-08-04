#!/usr/bin/env python3
"""build_system_tier.py — M19.1 system-tier aggregator (PLAN-v5 §1.3).

Rolls the project envelope's already-parsed data (per-file IRs +
entryPoints[] + threads[]) up one level into the ``system`` field:
``subsystems[]`` and cross-subsystem ``edges[]``. This is *pure
derivation* — it reads ``effectKind`` / ``callTarget`` / ``preview`` off
the per-file IR and never re-parses Python. Per PLAN-v5 §0.3 (the LIGHT
path) the system tier stays language-shallow: Python is deep-parsed
upstream; the frontend is a single node.

The ONE place this crosses the JS boundary is a *text* scan of frontend
source for route-path string literals (no JS parser, no AST) — emitted
as low-confidence ``calls`` edges.

How edges are derived (PLAN-v5 §1.3, §1.4):
  - ``effect`` edges (confidence ``high``): for each thread, find the
    functions it reaches (its seed/step nodes), then every per-file IR
    node carrying ``effectKind`` (db/http) — or matching the cache
    name-match heuristic — whose structural id sits *inside* a reached
    function. Each becomes an edge from the thread's owning endpoint to
    the target subsystem, carrying ``viaThread`` (the drill-down handle).
    Because edges are built by walking ``threads[]``, every effect edge
    traces back to a thread — threads ARE the drill-down.
  - ``calls`` edges (confidence ``low``): if a frontend is detected,
    scan its source as text for string literals matching a route's
    static prefix.

Cache is classified HERE, at the aggregation layer, by name-match over
existing IR fields — NOT a new per-file ``effectKind`` member. This is
what keeps the per-file IR frozen (PLAN-v5 §6, Q6).

stdin  : { "files": {<relpath>: <per-file IR>, ...},
           "entryPoints": [...], "threads": [...],
           "projectRoot": "<abs path>"   # optional; enables frontend scan
         }
stdout : { "system": { "subsystems": [...], "edges": [...] } }
"""

import json
import os
import re
import sys


# ── subsystem ordering (L-R reading: frontend → backend → cache/db/ext) ──
_KIND_ORDER = {
    "frontend": 0,
    "backend": 1,
    "cache": 2,
    "db": 3,
    "external_http": 4,
    "library": 5,
}

# Frameworks we recognise from a frontend package.json dependency.
_FW_DEPS = {
    "react": "React",
    "react-dom": "React",
    "next": "Next.js",
    "vue": "Vue",
    "@angular/core": "Angular",
    "svelte": "Svelte",
    "solid-js": "Solid",
}
# Component-file extensions that, on their own, signal a frontend.
_COMPONENT_EXT = (".jsx", ".tsx", ".vue", ".svelte")
# Extensions we text-scan for route-path string literals.
_SCAN_EXT = (".jsx", ".tsx", ".vue", ".svelte", ".js", ".ts", ".mjs")
_SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".vibegraph", "dist", "build"}

# A db/http effectKind already classified upstream maps to a subsystem;
# fs/subprocess/log are intra-backend detail, NOT system-tier subsystems
# (PLAN-v5 §1.2, §5.4).
_EFFECT_TO_SUBSYSTEM = {"db": "db", "http": "external_http"}

# Cache name-match: an identifier-boundary hit on redis / memcache(d) /
# cache in the call's target. Heuristic, low fidelity, acknowledged
# (PLAN-v5 §1.2). Does not catch `r = redis.Redis(); r.get()` — the
# receiver name carries no signal.
_CACHE_RE = re.compile(r"(?:^|[^A-Za-z0-9_])(redis|memcached|memcache|cache)(?:[^A-Za-z0-9_]|$)", re.I)

# A leading-slash string literal (single / double / backtick quoted).
_LITERAL_RE = re.compile(r"""(['"`])(/[^'"`\n]*?)\1""")
# A URL host inside a call preview, for external_http:<host> naming.
_URL_RE = re.compile(r"https?://([^/\s\"')]+)")


def _is_call_node(node):
    return node.get("type") == "call" or node.get("valueKind") == "call"


def _is_cache_call(node):
    if not _is_call_node(node):
        return False
    target = node.get("callTarget") or node.get("funcName") or ""
    return bool(_CACHE_RE.search(target))


def _http_host(node):
    m = _URL_RE.search(node.get("preview") or "")
    return m.group(1) if m else "unknown"


def _reached_functions(thread):
    """file -> set(function irNodeId) the thread steps through.

    seed/step nodes carry the (file, irNodeId) of a function the thread
    enters. Effect IR nodes are *children* of those functions, matched by
    structural-path prefix in _effects_in.
    """
    out = {}
    for n in thread.get("nodes", []):
        if n.get("kind") in ("seed", "step") and n.get("file") and n.get("irNodeId"):
            out.setdefault(n["file"], set()).add(n["irNodeId"])
    return out


def _within(node_id, fn_id):
    return node_id == fn_id or node_id.startswith(fn_id + "/")


def _effects_in(files, reached):
    """Yield (subsystem_id, effect_kind, evidence, file, line) for every
    effect-bearing IR node inside a reached function."""
    for file, fn_ids in reached.items():
        ir = files.get(file)
        if not ir:
            continue
        for node in ir.get("nodes", []):
            nid = node.get("id", "")
            if not any(_within(nid, f) for f in fn_ids):
                continue
            ek = node.get("effectKind")
            if ek == "db":
                yield "db", "db", "effectKind", file, node.get("line")
            elif ek == "http":
                yield "external_http:" + _http_host(node), "http", "effectKind", file, node.get("line")
            elif ek in ("fs", "subprocess", "log"):
                continue  # §5.4 — not a system-tier subsystem
            elif _is_cache_call(node):
                yield "cache", "cache", "name-match", file, node.get("line")


def _thread_owner(entry_point, has_routes):
    """Which subsystem owns this thread's endpoint (PLAN-v5 §1.5, M-NN-2).

    Manual seeds and entry-point-less threads roll into ``library``.
    ``backend`` means *web* backend: route entries always own it, and
    other non-manual entries (cli / public_api / model / test) only roll
    into it when the project has routes at all — a routeless project's
    entry points own ``library``.
    """
    if entry_point is None or entry_point.get("kind") == "manual":
        return "library"
    if entry_point.get("kind") == "route":
        return "backend"
    return "backend" if has_routes else "library"


def _fmt_refs(ref_set):
    return [f"{f}:{ln}" for (f, ln) in sorted(ref_set, key=lambda r: (r[0], r[1] if r[1] is not None else -1))]


# ── frontend detection + route-string scan (the one text-only crossing) ──

def _detect_frontend(root):
    """Return {label, framework, detectedBy, path, scanFiles} or None.

    Detection is convention-only: a package.json with a known UI-framework
    dep, and/or the presence of component files. No JS is parsed.
    """
    if not root or not os.path.isdir(root):
        return None
    framework = None
    pkg_dep = None
    pkg_dir = None
    component_count = 0
    scan_files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")]
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            if fn == "package.json" and framework is None:
                try:
                    with open(full, encoding="utf-8") as fh:
                        pkg = json.load(fh)
                    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                    for dep, label in _FW_DEPS.items():
                        if dep in deps:
                            framework, pkg_dep, pkg_dir = label, dep, dirpath
                            break
                except Exception:
                    pass
            if fn.endswith(_COMPONENT_EXT):
                component_count += 1
            if fn.endswith(_SCAN_EXT):
                scan_files.append(full)
    if framework is None and component_count == 0:
        return None
    detected = []
    if pkg_dep:
        detected.append(f"package.json:{pkg_dep}")
    if component_count:
        detected.append(f"{component_count} component file(s)")
    # Frontend root: the package.json dir if found, else the common parent
    # of the scanned files.
    base = pkg_dir or (os.path.commonpath(scan_files) if scan_files else root)
    if os.path.isfile(base):
        base = os.path.dirname(base)
    rel_path = os.path.relpath(base, root)
    return {
        "label": (framework + " app") if framework else "Frontend",
        "framework": framework,
        "detectedBy": " + ".join(detected),
        "path": "" if rel_path == "." else rel_path,
        "scanFiles": sorted(scan_files),
    }


def _route_prefix(route):
    """Static prefix of a route — truncated at the first path parameter.

    `/users/<int:uid>` -> `/users/`, `/api/users` -> `/api/users`,
    `/items/{id}` -> `/items/`.
    """
    for i, ch in enumerate(route):
        if ch in "<{":
            return route[:i]
        if ch == ":" and i > 0 and route[i - 1] == "/":
            return route[:i]
    return route


def _match_routes(literal, route_eps):
    """Return the route entry points whose static prefix is the LONGEST
    prefix matching this literal (ties all returned)."""
    best_len = -1
    best = []
    for ep, prefix in route_eps:
        if literal == ep["metadata"].get("route") or literal == prefix or \
           (prefix.endswith("/") and literal.startswith(prefix)) or \
           literal.startswith(prefix + "/"):
            if len(prefix) > best_len:
                best_len, best = len(prefix), [ep]
            elif len(prefix) == best_len:
                best.append(ep)
    return best


def _scan_calls_edges(frontend, entry_points, root):
    """Text-scan frontend source for route-path literals -> calls edges."""
    route_eps = [
        (ep, _route_prefix(ep["metadata"].get("route", "")))
        for ep in entry_points
        if ep.get("kind") == "route" and ep.get("metadata", {}).get("route")
    ]
    if not route_eps:
        return {}
    # (from, to) -> set of (relfile, line)
    edges = {}
    for full in frontend["scanFiles"]:
        rel = os.path.relpath(full, root)
        try:
            with open(full, encoding="utf-8") as fh:
                text = fh.read()
        except Exception:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            for m in _LITERAL_RE.finditer(line):
                literal = m.group(2)
                static = literal.split("${", 1)[0].split("{", 1)[0]
                for ep in _match_routes(static, route_eps):
                    key = ("frontend", "backend:" + ep["id"])
                    edges.setdefault(key, set()).add((rel, lineno))
    return edges


def build_system(files, entry_points, threads, project_root=None):
    ep_by_id = {ep["id"]: ep for ep in entry_points}
    has_routes = any(ep.get("kind") == "route" for ep in entry_points)

    # ── effect edges, keyed (from, to, effectKind) -> refs ──
    effect_edges = {}
    edge_evidence = {}
    for thread in threads:
        epid = thread.get("entryPointId")
        ep = ep_by_id.get(epid)
        owner = _thread_owner(ep, has_routes)
        from_id = f"{owner}:{epid}" if epid else owner
        reached = _reached_functions(thread)
        for to_id, effect_kind, evidence, file, line in _effects_in(files, reached):
            key = (from_id, to_id, effect_kind)
            effect_edges.setdefault(key, set()).add((file, line))
            edge_evidence[key] = evidence

    # ── calls edges (frontend text-scan) ──
    frontend = _detect_frontend(project_root) if project_root else None
    calls_edges = _scan_calls_edges(frontend, entry_points, project_root) if frontend else {}

    # ── assemble edge list ──
    edges = []
    for (from_id, to_id, effect_kind), refs in effect_edges.items():
        edges.append({
            "from": from_id,
            "to": to_id,
            "kind": "effect",
            "effectKind": effect_kind,
            "confidence": "high",
            "evidence": edge_evidence[(from_id, to_id, effect_kind)],
            "viaThread": from_id.split(":", 1)[1] if ":" in from_id else None,
            "refs": _fmt_refs(refs),
        })
    for (from_id, to_id), refs in calls_edges.items():
        edges.append({
            "from": from_id,
            "to": to_id,
            "kind": "calls",
            "confidence": "low",
            "evidence": "string-scan",
            "refs": _fmt_refs(refs),
        })
    edges.sort(key=lambda e: (e["kind"], e["from"], e["to"]))

    # ── subsystems referenced by edges + structural ones ──
    referenced = set()
    for e in edges:
        for endpoint in (e["from"], e["to"]):
            head = endpoint.split(":", 1)[0]
            if endpoint.startswith("external_http:"):
                referenced.add(endpoint)
            else:
                referenced.add(head)

    subsystems = []

    # backend — requires web routes (M-NN-2): emitted when route entries
    # exist, or an edge already references it. Routeless non-manual
    # entries (cli / public_api / model / test) own `library` instead.
    non_manual_eps = [ep for ep in entry_points if ep.get("kind") != "manual"]
    route_eps = [ep for ep in non_manual_eps if ep.get("kind") == "route"]
    library_eps = [] if has_routes else non_manual_eps
    if route_eps or "backend" in referenced:
        framework = next((ep.get("framework") for ep in route_eps if ep.get("framework")), None)
        if framework is None:
            framework = next((ep.get("framework") for ep in non_manual_eps if ep.get("framework")), None)
        subsystems.append({
            "id": "backend",
            "kind": "backend",
            "label": (framework.capitalize() + " backend") if framework else "Backend",
            "framework": framework,
            "endpointRefs": sorted(ep["id"] for ep in route_eps),
            "fileCount": len(files),
        })

    # frontend — convention-detected
    if frontend:
        subsystems.append({
            "id": "frontend",
            "kind": "frontend",
            "label": frontend["label"],
            "framework": frontend["framework"],
            "detectedBy": frontend["detectedBy"],
            "path": frontend["path"],
        })

    # cache / db / external_http:<host> / library — on demand from edges
    if "cache" in referenced:
        subsystems.append({"id": "cache", "kind": "cache", "label": "Cache", "evidence": "name-match"})
    if "db" in referenced:
        subsystems.append({"id": "db", "kind": "db", "label": "Database", "evidence": "effectKind:db"})
    for host in sorted(s for s in referenced if s.startswith("external_http:")):
        subsystems.append({
            "id": host,
            "kind": "external_http",
            "label": host.split(":", 1)[1],
            "evidence": "effectKind:http",
        })
    if "library" in referenced or library_eps:
        card = {
            "id": "library",
            "kind": "library",
            "label": "Library / internal",
        }
        if library_eps:
            # The routeless project's own entry points — the card owns
            # them exactly as backend owns its routes (M-NN-2).
            card["endpointRefs"] = sorted(ep["id"] for ep in library_eps)
            card["fileCount"] = len(files)
        subsystems.append(card)

    subsystems.sort(key=lambda s: (_KIND_ORDER.get(s["kind"], 99), s["id"]))
    return {"subsystems": subsystems, "edges": edges}


def main():
    payload = json.load(sys.stdin)
    system = build_system(
        payload.get("files", {}),
        payload.get("entryPoints", []),
        payload.get("threads", []),
        payload.get("projectRoot"),
    )
    json.dump({"system": system}, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
