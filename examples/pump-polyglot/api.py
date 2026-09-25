"""Flask API over the trained pump-wear model — the Python service the
TypeScript dashboard and the bash pipeline talk to over HTTP.

Two routes: `/health` (GET) and `/predict` (POST). `/predict` takes
`{"readings": [8 floats]}` and returns `{"wear": float}` in wear units —
the same contract `dashboard/schema.ts` validates on the way in and
`ops/pipeline.sh` smoke-tests after a deploy.
"""

from flask import Flask, jsonify, request

from data import DATA_PATH, load
from predict import load_model, predict_wear

app = Flask(__name__)
FEATURES = 8

_model = None
_scaler = None


def _ensure_loaded():
    """Load the model and the training-fitted target scaler once."""
    global _model, _scaler
    if _model is None:
        _model = load_model()
        _train_x, _train_y, _test_x, _test_y, _scaler = load(DATA_PATH)
    return _model, _scaler


@app.route("/health")
def health():
    """Liveness for the pipeline's smoke check."""
    return jsonify({"ok": True})


@app.route("/predict", methods=["POST"])
def predict_route():
    """Score one row of 8 sensor readings; 400 on a bad payload."""
    payload = request.get_json()
    readings = payload.get("readings") if payload else None
    if not isinstance(readings, list) or len(readings) != FEATURES:
        return jsonify({"error": f"readings must be a list of {FEATURES} numbers"}), 400
    model, scaler = _ensure_loaded()
    wear = predict_wear(model, [float(v) for v in readings], scaler)
    return jsonify({"wear": wear})


if __name__ == "__main__":
    app.run(port=5000)
