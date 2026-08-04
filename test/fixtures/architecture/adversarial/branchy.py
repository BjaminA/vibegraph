"""Adversarial model: a DYNAMIC forward() — a runtime branch + a functional
op. The schematic must not present this as a fake linear stack (it surfaces a
'branches' marker); the forward thread must show both arms honestly.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class BranchyNet(nn.Module):
    def __init__(self, use_attention=False):
        super().__init__()
        self.conv = nn.Conv2d(3, 16, 3)
        self.norm = nn.BatchNorm2d(16)
        self.pool = nn.MaxPool2d(2)
        self.attn = nn.MultiheadAttention(16, 4)
        self.fc = nn.Linear(16, 10)
        self.use_attention = use_attention

    def forward(self, x):
        x = self.conv(x)
        x = self.norm(x)
        x = F.relu(x)
        if self.use_attention:
            x = self.attn(x)
        else:
            x = self.pool(x)
        x = self.fc(x)
        return x
