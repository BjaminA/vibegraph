"""The dataset catalogue as a repository: logic here, storage injected."""
from typing import Protocol


class CatalogRepo(Protocol):
    def save(self, name: str, meta: dict) -> None: ...

    def get(self, name: str) -> dict: ...


class AuditSink(Protocol):
    """A port nothing in the project implements."""

    def record(self, line: str) -> None: ...


def register(name: str, meta: dict, repo: CatalogRepo, audit: AuditSink) -> None:
    if not repo.get(name):
        repo.save(name, meta)
        audit.record(f"registered {name}")
