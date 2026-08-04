#!/usr/bin/env python3
"""
One-shot helper to regenerate the cross-file linker snapshots
(``*.ir.json``) when the linker's emitted shape changes legitimately.

Reads each fixture's per-file ``.py`` sources, runs them through
``parse_cst.py`` then ``cross_file_link.py``, and writes the merged
result to the fixture's ``.ir.json``.

Use this when you have intentionally changed parser or linker output
(schema bump, new field, ratchet) and the snapshot drift in
``test/parser.test.mjs`` is expected. Always inspect the diff before
committing.

Run:
    PYTHONPATH=.pydeps python3 scripts/regen_link_fixtures.py
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARSER = ROOT / "scripts" / "parse_cst.py"
LINKER = ROOT / "scripts" / "cross_file_link.py"

FIXTURES = [
    (ROOT / "test" / "fixtures" / "project",
     ["main.py", "models.py", "utils.py"],
     ROOT / "test" / "fixtures" / "project" / "project.ir.json"),
    (ROOT / "test" / "fixtures" / "threads" / "aero_demo",
     ["main.py", "data.py", "processing.py", "registry.py", "models.py"],
     ROOT / "test" / "fixtures" / "threads" / "aero_demo" / "aero_demo.ir.json"),
    (ROOT / "test" / "fixtures" / "threads" / "flask_demo",
     ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"],
     ROOT / "test" / "fixtures" / "threads" / "flask_demo" / "flask_demo.ir.json"),
    # §5.6a — exception-path flow joins. run_job carries a full
    # try/except/finally; app.py imports it so it's a discovered entry.
    (ROOT / "test" / "fixtures" / "threads" / "exc_demo",
     ["jobs.py", "app.py"],
     ROOT / "test" / "fixtures" / "threads" / "exc_demo" / "exc_demo.ir.json"),
    # M19.1 — system-tier fixture. Backend .py only; the web/ frontend is
    # never parsed (LIGHT path) — the aggregator text-scans it instead.
    (ROOT / "test" / "fixtures" / "system" / "system_demo",
     ["app.py", "store.py", "payments.py", "cache.py"],
     ROOT / "test" / "fixtures" / "system" / "system_demo" / "system_demo.ir.json"),
    # M-FS2 — head-local receiver driving a project class: the viaLocal
    # edge's target method exists in-project, so the thread steps in.
    (ROOT / "test" / "fixtures" / "threads" / "receiver_demo",
     ["main.py", "engine.py"],
     ROOT / "test" / "fixtures" / "threads" / "receiver_demo" / "receiver_demo.ir.json"),
    # M-NN-2 — routeless pure-ML/library project (the neural-net
    # rehearsal's generated CNN): model + public_api + cli entries, no
    # routes → one `library` subsystem, never `backend`.
    (ROOT / "test" / "fixtures" / "system" / "library_only",
     ["model.py", "synthetic_data.py", "train.py", "evaluate.py"],
     ROOT / "test" / "fixtures" / "system" / "library_only" / "library_only.ir.json"),
]


def parse_file(file_path: Path, module_path: str) -> dict:
    r = subprocess.run(
        ["python3", str(PARSER), str(file_path), "--module-path", module_path],
        capture_output=True, text=True, cwd=ROOT,
    )
    if r.returncode != 0:
        raise SystemExit(f"parser failed for {file_path}: {r.stderr}")
    return json.loads(r.stdout)


def link(files: dict) -> dict:
    r = subprocess.run(
        ["python3", str(LINKER)],
        capture_output=True, text=True, cwd=ROOT,
        input=json.dumps({"files": files}),
    )
    if r.returncode != 0:
        raise SystemExit(f"linker failed: {r.stderr}")
    return json.loads(r.stdout)["files"]


def main() -> None:
    for fixture_dir, file_list, out_path in FIXTURES:
        print(f"regenerating {out_path.relative_to(ROOT)}…", file=sys.stderr)
        files = {}
        for fname in file_list:
            mod = fname[:-3]
            files[fname] = parse_file(fixture_dir / fname, mod)
        linked = link(files)
        out_path.write_text(json.dumps(linked, indent=2) + "\n")
    print("done.", file=sys.stderr)


if __name__ == "__main__":
    main()
