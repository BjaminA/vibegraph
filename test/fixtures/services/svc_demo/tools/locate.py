"""Find the outside programs this project runs."""
import shutil


def find_renderer(override=None):
    if override:
        return override
    return shutil.which("pagerender")
