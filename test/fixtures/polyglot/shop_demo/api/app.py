"""shop_demo API — the Python half of the polyglot fixture (M-CONTRACT).

Routes call into orders.py (validation + pricing) and db.py (sqlite),
and notify the TypeScript gateway over HTTP — a cross-language hop the
IR can only ever see as an honest `http` external terminal. The
notify-per-item loop is a deliberate round-trip lever for the thread
contract to flag.
"""
from flask import Flask, jsonify, request
import requests

from orders import validate_order, price_order
from db import list_orders, insert_order

app = Flask(__name__)
GATEWAY_URL = "http://localhost:3000/events"


@app.route("/orders")
def get_orders():
    """List the newest orders, capped at 50."""
    rows = list_orders(50)
    return jsonify(rows)


@app.route("/orders", methods=["POST"])
def create_order():
    """Validate, price, persist, then notify the gateway PER LINE ITEM."""
    payload = request.get_json()
    order = validate_order(payload)
    priced = price_order(order)
    order_id = insert_order(priced)
    for item in priced["items"]:
        requests.post(GATEWAY_URL, json={"order_id": order_id, "sku": item["sku"]}, timeout=2)
    return jsonify({"id": order_id, "total": priced["total"]}), 201
