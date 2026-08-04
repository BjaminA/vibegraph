"""Score new pump readings with the trained model.

`data/holdout.csv` is deliberately NOT in this repo. `evaluate_holdout`
is the example's honest-failure path: run it and it tells you the file is
missing rather than inventing a number.
"""

import torch

from data import DATA_PATH, Standardizer, load, read_rows
from metrics import r_squared
from model import build_model

HOLDOUT_PATH = "data/holdout.csv"
WEIGHTS_PATH = "model.pt"


def load_model(path=WEIGHTS_PATH):
    """Rebuild the network and load trained weights from disk."""
    model = build_model()
    model.load_state_dict(torch.load(path))
    model.eval()
    return model


def predict_wear(model, features, target_scaler):
    """Predict a wear score for one row of 8 sensor readings.

    Returns wear UNITS, not standardized units — the model is trained on a
    standardized target, so the scaler has to be inverted on the way out.
    """
    row = torch.tensor([features], dtype=torch.float32)
    with torch.no_grad():
        standardized = model(row).item()
    return target_scaler.invert(standardized)


def evaluate_holdout(path=HOLDOUT_PATH):
    """Score the model on a holdout file with the same 9-column schema as
    `data/pump.csv`: 8 sensor features then the `wear` target.

    Raises FileNotFoundError when the holdout file is absent — which it is
    by default in this example.
    """
    model = load_model()
    # The training file supplies the feature scaling; a holdout scored with
    # its own statistics would not be comparable to the test R².
    _train_x, _train_y, _test_x, _test_y, target_scaler = load(DATA_PATH)

    features, targets = read_rows(path)
    predictions = []
    for row in features:
        predictions.append(predict_wear(model, list(row), target_scaler))

    score = r_squared(predictions, targets)
    print(f"holdout R2 {score:.4f}  over {len(targets)} rows")
    return score


if __name__ == "__main__":
    evaluate_holdout()
