"""Loads the trained artifact and scores a value."""

import pickle


def load_weights(path):
    with open(path, "rb") as f:
        return pickle.load(f)


def predict(value):
    weights = load_weights("model.pkl")
    return value * weights["scale"]
