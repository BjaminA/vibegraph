"""Binds its subject's names at run time, the way some test files do."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fmt
from ids import *

globals().update({k: v for k, v in vars(fmt).items() if not k.startswith("__")})


def test_render_jobs():
    assert render("jobs", ["a"]) == ["job a"]


def test_mint():
    assert len(mint(2)) == 2
