"""Order validation and pricing — pure except the pricing-worker hop.

price_order shells out to the C++ worker (worker/main.cpp): a
cross-language boundary the IR sees as a `subprocess` external.
"""
import json
import subprocess

REQUIRED = ("customer", "items")


def validate_order(payload: dict) -> dict:
    """Reject payloads missing required keys; normalise quantities to int."""
    for key in REQUIRED:
        if key not in payload:
            raise ValueError(f"missing {key}")
    items = [{"sku": i["sku"], "qty": int(i.get("qty", 1))} for i in payload["items"]]
    return {"customer": payload["customer"], "items": items}


def price_order(order: dict) -> dict:
    """Price via the C++ pricing worker (one subprocess per order)."""
    proc = subprocess.run(["./worker/pricing", json.dumps(order["items"])], capture_output=True, text=True)
    total = float(proc.stdout.strip() or "0")
    return {**order, "total": total}
