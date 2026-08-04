"""Synthetic dataset for the CNN image classifier.

Generates random image tensors and matching integer class labels with no
disk, network, or database access — a self-contained source of training and
evaluation batches for the PyTorch CNN trainer.
"""

from __future__ import annotations

from typing import Tuple

import torch


def generate_batch(
    batch_size: int = 32,
    channels: int = 3,
    height: int = 28,
    width: int = 28,
    num_classes: int = 10,
    generator: torch.Generator | None = None,
) -> Tuple[torch.Tensor, torch.Tensor]:
    """Generate one batch of random images and matching class labels.

    Returns a tuple ``(images, labels)`` where ``images`` is a float tensor of
    shape ``(batch_size, channels, height, width)`` with values in ``[0, 1)``
    and ``labels`` is a 1-D int64 tensor of shape ``(batch_size,)`` with each
    entry in ``[0, num_classes)``.

    An optional ``generator`` makes the draw reproducible without touching
    global RNG state.
    """
    _validate_shape(batch_size, channels, height, width, num_classes)

    images = torch.rand(
        batch_size,
        channels,
        height,
        width,
        generator=generator,
    )
    labels = torch.randint(
        low=0,
        high=num_classes,
        size=(batch_size,),
        generator=generator,
        dtype=torch.int64,
    )
    return images, labels


def _validate_shape(
    batch_size: int,
    channels: int,
    height: int,
    width: int,
    num_classes: int,
) -> None:
    """Reject non-positive dimensions before any tensor is allocated."""
    dims = {
        "batch_size": batch_size,
        "channels": channels,
        "height": height,
        "width": width,
        "num_classes": num_classes,
    }
    for name, value in dims.items():
        if not isinstance(value, int) or value < 1:
            raise ValueError(f"{name} must be a positive integer, got {value!r}")
