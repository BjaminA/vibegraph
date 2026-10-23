"""Build the price report."""
from app.money import format_price
from lib.db.store import connect, prices


def build_report(path):
    rows = prices(connect(path))
    return "\n".join(f"{name}: {format_price(pence)}" for name, pence in rows)
