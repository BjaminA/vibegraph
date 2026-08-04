# M-NEST fixture — nested-call honesty in the Arch forward thread.
# FlatNet / ComposedNet: same architecture, flat vs composed (arg-nesting that
# v1 EXTRACTS). ChainNet: chains + comprehensions that v1 DETECTS but does not
# extract (the uncaptured backstop — must be badged, never silently complete).
import torch
import torch.nn as nn
import torch.nn.functional as F


class FlatNet(nn.Module):
    """Flat style: one call per line. The IR captures every layer -> the
    Arch view's data path shows conv1, conv2, fc all present."""

    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(3, 16, 3)
        self.conv2 = nn.Conv2d(16, 32, 3)
        self.fc = nn.Linear(32, 10)

    def forward(self, x):
        x = self.conv1(x)
        x = F.relu(x)
        x = self.conv2(x)
        x = F.relu(x)
        x = self.fc(x)
        return x


class ComposedNet(nn.Module):
    """Composed style: layers nested inside F.relu(...). The IR keeps only the
    OUTERMOST call (F.relu / self.fc) as nodes; conv1 and conv2 survive only as
    arg-TEXT inside those calls -> they DON'T appear in the forward data path,
    and today are reported declared-but-unused. THIS is what §B must flag."""

    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(3, 16, 3)
        self.conv2 = nn.Conv2d(16, 32, 3)
        self.fc = nn.Linear(32, 10)

    def forward(self, x):
        x = F.relu(self.conv1(x))
        x = F.relu(self.conv2(x))
        return self.fc(x)


class ChainNet(nn.Module):
    """Nests v1 DETECTS but does not extract: a method chain (self.proj in the
    callee position of `.relu()`) and a comprehension inside a call argument
    (self.head). Neither inner call is decomposed into a node, so the forward
    path is incomplete here — it must carry the 'uncaptured' badge, never read
    as silently complete."""

    def __init__(self):
        super().__init__()
        self.proj = nn.Linear(16, 16)
        self.head = nn.Linear(16, 4)

    def forward(self, x):
        x = self.proj(x).relu()                            # chain: self.proj uncaptured
        x = torch.stack([self.head(x) for _ in range(2)])  # comprehension: self.head uncaptured
        return x
