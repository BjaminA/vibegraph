"""Summarise a page with a hosted model."""
import json
import os
import urllib.request

MODEL_URL = os.environ.get("MODEL_URL", "https://api.openai.com/v1/chat/completions")


def summarise(text):
    body = json.dumps({"input": text}).encode()
    req = urllib.request.Request(MODEL_URL, data=body, headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


if __name__ == "__main__":
    print(summarise("hello"))
