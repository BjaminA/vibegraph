def greet(name: str) -> None:
    """Print a greeting for the given name."""
    print(f"Hello, {name}!")

def format_name(name: str) -> str:
    """Capitalize and strip whitespace."""
    return name.strip().title()

def farewell(name: str) -> None:
    print(f"Goodbye, {name}!")
