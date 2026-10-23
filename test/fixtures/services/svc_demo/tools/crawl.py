"""Crawl pages with the outside fetch program."""
import shutil

from tools.fetcher import PageFetcher


def crawl(urls):
    fetcher = PageFetcher(shutil.which("pagefetch") or "pagefetch")
    return [fetcher.fetch(u) for u in urls]
