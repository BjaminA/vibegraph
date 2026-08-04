"""Regression metrics. Dependency-free — stdlib only, so a reader can
follow the arithmetic without knowing torch or numpy."""


def r_squared(predictions, targets):
    """Coefficient of determination between two equal-length sequences.

    1.0 is perfect; 0.0 is no better than predicting the mean; negative
    means worse than the mean predictor. Accepts torch tensors, numpy
    arrays, or plain sequences of numbers.
    """
    preds = [float(p) for p in predictions]
    targs = [float(t) for t in targets]

    if len(preds) != len(targs):
        raise ValueError(
            f"length mismatch: {len(preds)} predictions vs {len(targs)} targets"
        )
    if not preds:
        raise ValueError("r_squared requires at least one value")

    mean = sum(targs) / len(targs)
    total = sum((t - mean) ** 2 for t in targs)
    residual = sum((p - t) ** 2 for p, t in zip(preds, targs))
    if total == 0.0:
        raise ValueError("r_squared is undefined when every target is identical")
    return 1.0 - residual / total
