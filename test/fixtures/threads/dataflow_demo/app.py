"""Data-flow demo: one function whose calls hand results to each other."""


def load(path):
    """Two lists read from a path."""
    return [1, 2, 3], [4, 5, 6]


def build(size):
    """A model sized from the data."""
    return {"size": size}


def train(model, xs, ys):
    """Fit the model; returns it."""
    model["fit"] = len(xs) + len(ys)
    return model


def main():
    xs, ys = load("data.csv")
    model = build(len(xs))
    train(model, xs, ys)


if __name__ == "__main__":
    main()
