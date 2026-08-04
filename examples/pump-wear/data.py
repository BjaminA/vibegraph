"""Load pump-sensor data into standardized float32 tensors.

Eight sensor columns predict a continuous `wear` score. BOTH the features
and the target are standardized using statistics fitted on the TRAINING
split only — raw scales put the target in the tens while the features
range from 0.2 to 3000, and an MLP trained on that lands at R² below zero.
"""

import csv

import numpy as np
import torch

DATA_PATH = "data/pump.csv"
FEATURE_COLUMNS = 8


class Standardizer:
    """Scale a value by a fitted mean/std, and put a scaled value back.

    Defaults are the identity transform, so an un-fitted Standardizer
    passes values through unchanged.
    """

    def __init__(self, mean=0.0, std=1.0):
        self.mean = mean
        self.std = std

    def apply(self, value):
        """Standardize `value` — the forward direction."""
        return (value - self.mean) / self.std

    def invert(self, value):
        """Undo `apply` — turns a model output back into wear units."""
        return value * self.std + self.mean


def read_rows(path=DATA_PATH):
    """Read the CSV into (features, targets) float64 arrays."""
    features = []
    targets = []
    with open(path, newline="") as handle:
        reader = csv.reader(handle)
        next(reader)
        for row in reader:
            features.append([float(v) for v in row[:FEATURE_COLUMNS]])
            targets.append(float(row[FEATURE_COLUMNS]))
    return np.array(features, dtype=np.float64), np.array(targets, dtype=np.float64)


def target_stats(path=DATA_PATH):
    """Return the wear column's (mean, std) over the whole file.

    Reported alongside R² so a reader can judge the error in wear units
    rather than in standardized ones.
    """
    _features, targets = read_rows(path)
    return float(targets.mean()), float(targets.std())


def split_positional(features, targets, train_fraction=0.8):
    """Slice 80/20 by position — no shuffle, so the split is reproducible."""
    n_train = int(len(features) * train_fraction)
    return (
        features[:n_train],
        targets[:n_train],
        features[n_train:],
        targets[n_train:],
    )


def load(path=DATA_PATH):
    """Read, split, standardize, and return tensors plus the target scaler.

    The returned `Standardizer` is fitted on the training target, so
    `predict.py` can convert model outputs back into wear units.
    """
    features, targets = read_rows(path)
    train_x, train_y, test_x, test_y = split_positional(features, targets)

    feature_mean = train_x.mean(axis=0)
    feature_std = train_x.std(axis=0)
    feature_std[feature_std == 0.0] = 1.0
    train_x = (train_x - feature_mean) / feature_std
    test_x = (test_x - feature_mean) / feature_std

    target_scaler = Standardizer(float(train_y.mean()), float(train_y.std()))
    train_y = target_scaler.apply(train_y)
    test_y = target_scaler.apply(test_y)

    return (
        torch.tensor(train_x, dtype=torch.float32),
        torch.tensor(train_y, dtype=torch.float32).reshape(-1, 1),
        torch.tensor(test_x, dtype=torch.float32),
        torch.tensor(test_y, dtype=torch.float32).reshape(-1, 1),
        target_scaler,
    )
