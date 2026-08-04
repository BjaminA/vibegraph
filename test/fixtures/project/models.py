class User:
    """Simple user model."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.active = True

    def deactivate(self) -> None:
        self.active = False

    def __repr__(self) -> str:
        status = "active" if self.active else "inactive"
        return f"User({self.name!r}, {status})"
