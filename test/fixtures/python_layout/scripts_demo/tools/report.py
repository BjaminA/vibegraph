#!/usr/bin/env python3
"""Uses its siblings by bare name: python puts tools/ on the path."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import envfile
import fmt
import paths
from ids import mint


def norm_name(s):
    return s.strip().lower()


def host_of(url):
    """Pure: tools/paths.py has an effectful function of the same name."""
    return url.split("/")[2]


def is_primary(url):
    return url.startswith("http://x")


def where():
    return Path.cwd()


def scan(urls):
    """Pure helpers in the loop; the same-named effectful ones only outside it."""
    out = []
    for u in urls:
        if is_primary(u):
            out.append(host_of(u))
    return out, paths.host_of("x")


def stamp_each(urls):
    """The control: this loop really does touch the file system."""
    return [str(where()) + u for u in urls]


def titles(pages):
    """parser.feed() inside title_of is a method TitleParser inherits."""
    from page import title_of
    return [title_of(p) for p in pages]


def first_title(html):
    """The same inherited method, called here on another module's class."""
    from page import TitleParser
    parser = TitleParser()
    parser.feed(html)
    return parser.title


def main(argv=None):
    urls = list(argv or sys.argv[1:])
    envfile.load("settings.txt")
    rows = [norm_name(n) for n in urls]
    print(scan(urls), stamp_each(urls), titles(urls), first_title(""))
    return fmt.render("jobs", rows), mint(2)


if __name__ == "__main__":
    main()
