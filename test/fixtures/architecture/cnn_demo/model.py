"""Small CNN image classifier — architecture-view fixture.

forward() is written one-call-per-line so every layer application is an
OUTERMOST call (the IR drops nested/composed calls; functional ops like
F.relu / x.view are shown by the forward thread, not the layer schematic).
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class SmallCNN(nn.Module):
    def __init__(self, num_classes=10):
        super().__init__()
        self.conv1 = nn.Conv2d(3, 32, 3, padding=1)
        self.bn1 = nn.BatchNorm2d(32)
        self.pool = nn.MaxPool2d(2)
        self.conv2 = nn.Conv2d(32, 64, 3, padding=1)
        self.dropout = nn.Dropout(0.25)
        self.fc1 = nn.Linear(64 * 8 * 8, 128)
        self.fc2 = nn.Linear(128, num_classes)

    def forward(self, x):
        x = self.conv1(x)
        x = self.bn1(x)
        x = F.relu(x)
        x = self.pool(x)
        x = self.conv2(x)
        x = F.relu(x)
        x = self.pool(x)
        x = self.dropout(x)
        x = x.view(x.size(0), -1)
        x = self.fc1(x)
        x = F.relu(x)
        x = self.fc2(x)
        return x


class Trainer:
    """Not an nn.Module — must NOT be recognized as a model."""

    def __init__(self, model, lr=0.001):
        self.model = model
        self.lr = lr

    def step(self, batch):
        return batch
