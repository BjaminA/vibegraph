#!/usr/bin/env python3
"""Thin script: the program lives in pkg/cli.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pkg.cli import main

if __name__ == "__main__":
    sys.exit(main())
