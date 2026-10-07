"""The real program behind tools/run.py."""
from pkg.util import shout


def main():
    """Print a greeting."""
    print(shout("hello"))
    return 0
