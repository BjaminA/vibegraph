"""Training loop for the synthetic-dataset CNN image classifier.

Instantiates a :class:`CNNClassifier`, iterates a few epochs over batches
drawn from the synthetic dataset, computes cross-entropy loss and steps an
Adam optimizer, then calls :func:`evaluate.evaluate` to report top-1
accuracy after training.

The numeric core (``train_model`` / ``train_epoch``) performs only in-memory
tensor work — no disk, network, or database access — so it is checkable
without any I/O. ``main`` is the thin, effectful (printing) entry point.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import torch
import torch.nn.functional as F

from model import CNNClassifier
from synthetic_data import generate_batch
from evaluate import evaluate


@dataclass
class TrainingReport:
    """Outcome of a training run.

    ``epoch_losses`` holds the mean cross-entropy loss for each epoch (one
    entry per epoch, in order). ``final_accuracy`` is the post-training top-1
    accuracy in ``[0.0, 1.0]`` reported by :func:`evaluate.evaluate`.
    """

    epoch_losses: List[float]
    final_accuracy: float


def _make_generator(seed: Optional[int]) -> Optional[torch.Generator]:
    """Build a seeded RNG for reproducible batches, or ``None`` for global RNG."""
    if seed is None:
        return None
    generator = torch.Generator()
    generator.manual_seed(seed)
    return generator


def train_epoch(
    model: CNNClassifier,
    optimizer: torch.optim.Optimizer,
    steps_per_epoch: int,
    batch_size: int,
    in_channels: int,
    image_size: int,
    num_classes: int,
    generator: Optional[torch.Generator] = None,
) -> float:
    """Run one epoch of ``steps_per_epoch`` optimizer steps; return mean loss.

    Each step draws a fresh synthetic batch, computes cross-entropy loss
    against the integer labels, backpropagates, and steps the optimizer.
    """
    if steps_per_epoch < 1:
        raise ValueError(
            f"steps_per_epoch must be a positive integer, got {steps_per_epoch!r}"
        )

    model.train()
    running_loss = 0.0
    for _ in range(steps_per_epoch):
        images, labels = generate_batch(
            batch_size=batch_size,
            channels=in_channels,
            height=image_size,
            width=image_size,
            num_classes=num_classes,
            generator=generator,
        )

        optimizer.zero_grad()
        logits = model(images)
        loss = F.cross_entropy(logits, labels)
        loss.backward()
        optimizer.step()

        running_loss += float(loss.item())

    return running_loss / steps_per_epoch


def train_model(
    epochs: int = 3,
    steps_per_epoch: int = 8,
    batch_size: int = 16,
    num_classes: int = 10,
    image_size: int = 32,
    in_channels: int = 3,
    learning_rate: float = 1e-3,
    eval_batches: int = 5,
    seed: Optional[int] = None,
) -> TrainingReport:
    """Instantiate, train, and evaluate the CNN; return a :class:`TrainingReport`.

    A fresh ``CNNClassifier`` is trained for ``epochs`` epochs (each of
    ``steps_per_epoch`` batches) with an Adam optimizer on cross-entropy loss,
    then scored with :func:`evaluate.evaluate` over ``eval_batches`` held-out
    synthetic batches. Passing ``seed`` makes weight init, training batches,
    and evaluation batches reproducible.
    """
    if epochs < 1:
        raise ValueError(f"epochs must be a positive integer, got {epochs!r}")
    if eval_batches < 1:
        raise ValueError(
            f"eval_batches must be a positive integer, got {eval_batches!r}"
        )

    if seed is not None:
        # deterministic weight initialisation (global RNG, no I/O)
        torch.manual_seed(seed)

    model = CNNClassifier(
        in_channels=in_channels,
        num_classes=num_classes,
        image_size=image_size,
    )
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

    train_gen = _make_generator(None if seed is None else seed + 1)
    epoch_losses: List[float] = []
    for _ in range(epochs):
        epoch_losses.append(
            train_epoch(
                model=model,
                optimizer=optimizer,
                steps_per_epoch=steps_per_epoch,
                batch_size=batch_size,
                in_channels=in_channels,
                image_size=image_size,
                num_classes=num_classes,
                generator=train_gen,
            )
        )

    eval_gen = _make_generator(None if seed is None else seed + 2)
    final_accuracy = evaluate(
        model,
        num_batches=eval_batches,
        batch_size=batch_size,
        num_classes=num_classes,
        image_size=image_size,
        in_channels=in_channels,
        generator=eval_gen,
    )

    return TrainingReport(epoch_losses=epoch_losses, final_accuracy=final_accuracy)


def main() -> None:
    """Train with default settings and print per-epoch loss and final accuracy."""
    report = train_model(seed=0)
    for epoch, loss in enumerate(report.epoch_losses, start=1):
        print(f"epoch {epoch}: mean loss {loss:.4f}")
    print(f"final accuracy: {report.final_accuracy:.4f}")


if __name__ == "__main__":
    main()
