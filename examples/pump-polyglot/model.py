"""PyTorch MLP that predicts pump wear from 8 sensor measurements."""

import torch.nn as nn


class WearMLP(nn.Module):
    """8 sensor features -> 64 -> 32 -> 1 wear score.

    Every layer is listed literally in the `nn.Sequential` call. Building
    them in a loop and splatting (`nn.Sequential(*layers)`) cannot be
    enumerated statically, so the Arch view would honestly collapse the
    whole stack into one card instead of drawing the schematic.
    """

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(8, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
        )

    def forward(self, x):
        return self.net(x)


def build_model():
    """Return a fresh WearMLP."""
    return WearMLP()
