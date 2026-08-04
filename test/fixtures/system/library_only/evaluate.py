"""Evaluation for the synthetic-dataset CNN classifier.

Runs a trained (or untrained) ``CNNClassifier`` over freshly generated
synthetic batches in no-grad / eval mode and reports top-1 classification
accuracy: the fraction of predictions (argmax of the logits) that match the
integer labels.

The scoring core (``accuracy_from_logits``) is a pure tensor function so it
can be checked without allocating a model or touching the dataset.
"""

from __future__ import annotations

import torch

from model import CNNClassifier
from synthetic_data import generate_batch


def accuracy_from_logits(logits: torch.Tensor, labels: torch.Tensor) -> float:
    """Fraction of rows whose argmax-over-classes matches the label.

    ``logits`` is ``(N, num_classes)`` and ``labels`` is a 1-D int tensor of
    shape ``(N,)``. Returns a Python float in ``[0.0, 1.0]``; an empty batch
    scores ``0.0`` rather than dividing by zero.
    """
    if logits.dim() != 2:
        raise ValueError(
            f"logits must be 2-D (N, num_classes), got shape {tuple(logits.shape)}"
        )
    if labels.dim() != 1:
        raise ValueError(f"labels must be 1-D (N,), got shape {tuple(labels.shape)}")
    if logits.shape[0] != labels.shape[0]:
        raise ValueError(
            f"batch mismatch: {logits.shape[0]} logit rows vs {labels.shape[0]} labels"
        )

    total = labels.shape[0]
    if total == 0:
        return 0.0

    predictions = torch.argmax(logits, dim=1)
    correct = (predictions == labels).sum().item()
    return correct / total


def evaluate(
    model: CNNClassifier,
    num_batches: int = 10,
    batch_size: int = 32,
    num_classes: int = 10,
    image_size: int = 32,
    in_channels: int = 3,
    generator: torch.Generator | None = None,
) -> float:
    """Run ``model`` over ``num_batches`` synthetic batches and return accuracy.

    Evaluation happens in ``model.eval()`` under ``torch.no_grad()`` so no
    gradients are tracked. Accuracy is aggregated across every sample of every
    batch (not averaged per-batch), so uneven final batches would still weight
    correctly. Returns a Python float in ``[0.0, 1.0]``.
    """
    if num_batches < 1:
        raise ValueError(f"num_batches must be a positive integer, got {num_batches!r}")

    was_training = model.training
    model.eval()

    total_correct = 0
    total_seen = 0
    try:
        with torch.no_grad():
            for _ in range(num_batches):
                images, labels = generate_batch(
                    batch_size=batch_size,
                    channels=in_channels,
                    height=image_size,
                    width=image_size,
                    num_classes=num_classes,
                    generator=generator,
                )
                logits = model(images)
                predictions = torch.argmax(logits, dim=1)
                total_correct += int((predictions == labels).sum().item())
                total_seen += labels.shape[0]
    finally:
        model.train(was_training)

    if total_seen == 0:
        return 0.0
    return total_correct / total_seen
