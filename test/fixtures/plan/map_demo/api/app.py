"""The ingest API: the one route the plan says takes readings."""
from flask import Flask, jsonify, request

from api.store import insert_reading

app = Flask(__name__)


def validate(body):
    """Reject a reading without a pump id or a numeric value."""
    return isinstance(body.get("pump_id"), str) and isinstance(body.get("reading"), (int, float))


@app.route("/readings", methods=["POST"])
def post_readings():
    body = request.get_json()
    if not validate(body):
        return jsonify({"error": "bad reading"}), 400
    insert_reading(body["pump_id"], body["reading"])
    return jsonify({"ok": True})
