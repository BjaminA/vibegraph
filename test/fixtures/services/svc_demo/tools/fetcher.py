"""A client for an outside fetch program."""
import subprocess


class PageFetcher:
    def __init__(self, binary, timeout=30):
        self.binary = binary
        self.timeout = timeout

    def fetch(self, url):
        return subprocess.run([self.binary, "scrape", url], timeout=self.timeout, capture_output=True)
