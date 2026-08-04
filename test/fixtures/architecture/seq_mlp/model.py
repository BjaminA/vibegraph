import torch
from torch import nn


class WearRegressor(nn.Module):
    """MLP declared as one nn.Sequential — the container-expansion case."""

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


class StarNet(nn.Module):
    """Sequential built from *layers — no minted members, stays collapsed."""

    def __init__(self, layers):
        super().__init__()
        self.body = nn.Sequential(*layers)

    def forward(self, x):
        return self.body(x)
