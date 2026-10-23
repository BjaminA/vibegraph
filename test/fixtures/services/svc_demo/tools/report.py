"""Render the report with the outside renderer."""
import subprocess

from tools.locate import find_renderer


def build_report(path):
    if path.endswith(".pdf"):
        binary = find_renderer()
        subprocess.run([binary, "--in", path], check=True)
