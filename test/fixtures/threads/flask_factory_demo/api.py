"""Blueprint module — handlers decorated on a module-level Blueprint."""
from flask import Blueprint, jsonify

from db import query

bp = Blueprint("api", __name__, url_prefix="/api")


@bp.route("/orders")
def list_orders():
    """All orders, oldest first."""
    return jsonify(query("SELECT id, total FROM orders ORDER BY id"))
