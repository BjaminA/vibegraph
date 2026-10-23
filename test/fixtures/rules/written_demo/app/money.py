"""Money helpers."""


def format_price(pence):
    """`format_price` rounds half up, never to even."""
    return f"{int(pence / 100 + 0.5)}"
