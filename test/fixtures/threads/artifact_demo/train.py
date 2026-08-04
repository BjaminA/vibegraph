"""Tiny trainer: fits weights and saves the model artifact."""

import pickle


def clamp(value, limit):
    """Cap one row at limit."""
    return value if value < limit else limit


def fit_weights(rows, limit=None):
    # The nested for/if is load-bearing for thread-chrome-overlap.spec.ts:
    # it renders a control-flow container INSIDE another, whose chip labels
    # used to collide. Keep the nesting (and the call inside the `if`, which
    # is what gives the inner container a laid-out child).
    total = 0.0
    for row in rows:
        if limit is not None:
            row = clamp(row, limit)
        total += row
    return {"scale": total / len(rows)}


def save_weights(weights, path):
    with open(path, "wb") as f:
        pickle.dump(weights, f)


def main():
    rows = [1.0, 2.0, 3.0]
    weights = fit_weights(rows, limit=2.5)
    save_weights(weights, "model.pkl")
    print("saved model.pkl")


if __name__ == "__main__":
    main()
