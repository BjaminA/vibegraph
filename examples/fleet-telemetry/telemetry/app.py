"""Flask API for fleet telemetry.

Routes: POST /ingest (a batch of readings), GET /devices/<device_id>
(summary), GET /export (CSV for the nightly BI job), GET /alerts
(recent alert events), GET /health.
"""

from flask import Flask, Response, jsonify, request

from telemetry.alerts import recent_events
from telemetry.auth import require_token
from telemetry.devices import device_summary, list_device_ids
from telemetry.export import export_csv
from telemetry.ingest import ingest_batch
from telemetry.storage import readings_between

app = Flask(__name__)


@app.route("/health")
def health():
    """Liveness for the deploy script's smoke loop."""
    return jsonify({"ok": True})


@app.route("/ingest", methods=["POST"])
def ingest_route():
    """Accept a batch of readings from the gateway; 401 without a token."""
    if not require_token(request):
        return jsonify({"error": "unauthorised"}), 401
    payload = request.get_json()
    result = ingest_batch(payload)
    if result["errors"]:
        return jsonify(result), 400
    return jsonify(result), 202


@app.route("/devices/<device_id>")
def device_route(device_id):
    """Latest reading per metric for one device."""
    summary = device_summary(device_id)
    if summary is None:
        return jsonify({"error": "unknown device"}), 404
    return jsonify(summary)


@app.route("/devices")
def devices_route():
    """Every known device id."""
    return jsonify({"devices": list_device_ids()})


@app.route("/export")
def export_route():
    """CSV of readings between two epoch seconds (defaults: last hour)."""
    since = int(request.args.get("since", 0))
    until = int(request.args.get("until", 0)) or None
    rows = readings_between(since, until)
    return Response(export_csv(rows), mimetype="text/csv")


@app.route("/alerts")
def alerts_route():
    """The most recent alert events, newest first."""
    return jsonify({"events": recent_events(50)})


if __name__ == "__main__":
    app.run(port=5000)
