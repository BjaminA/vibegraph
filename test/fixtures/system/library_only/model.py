"""Convolutional image classifier for the synthetic CNN trainer.

A compact ``nn.Module`` with exactly two convolutional layers followed by
two fully-connected layers. ``forward`` maps a batch of images
``(N, in_channels, H, W)`` to per-class logits ``(N, num_classes)``.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class CNNClassifier(nn.Module):
    """Two conv layers -> two linear layers -> per-class logits.

    The spatial dimensions are halved by a 2x2 max-pool after each conv,
    so the flattened feature size is derived from ``image_size`` and known
    at construction time (no lazy layers).
    """

    def __init__(
        self,
        in_channels: int = 3,
        num_classes: int = 10,
        image_size: int = 32,
        conv1_channels: int = 16,
        conv2_channels: int = 32,
        hidden_features: int = 128,
    ) -> None:
        super().__init__()

        if image_size % 4 != 0:
            raise ValueError(
                f"image_size must be divisible by 4 (two 2x2 pools), got {image_size}"
            )

        # --- convolutional stack (2 layers, each followed by a 2x2 pool) ---
        self.conv1 = nn.Conv2d(in_channels, conv1_channels, kernel_size=3, padding=1)
        self.conv2 = nn.Conv2d(conv1_channels, conv2_channels, kernel_size=3, padding=1)
        self.pool = nn.MaxPool2d(kernel_size=2, stride=2)

        # after two 2x2 pools the H,W are quartered
        pooled = image_size // 4
        self._flat_features = conv2_channels * pooled * pooled

        # --- fully-connected stack (2 layers) ---
        self.fc1 = nn.Linear(self._flat_features, hidden_features)
        self.fc2 = nn.Linear(hidden_features, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Map an image batch ``(N, C, H, W)`` to logits ``(N, num_classes)``."""
        x = self.pool(F.relu(self.conv1(x)))
        x = self.pool(F.relu(self.conv2(x)))
        x = torch.flatten(x, start_dim=1)
        x = F.relu(self.fc1(x))
        return self.fc2(x)
