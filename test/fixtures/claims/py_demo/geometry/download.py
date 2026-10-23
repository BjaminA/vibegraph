"""Download the source outlines: the one step in this folder that uses the network."""
import requests


def download_outlines(url):
    resp = requests.get(url, timeout=10)
    return resp.content
