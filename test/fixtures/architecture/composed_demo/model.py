# M-NEST fixture — nested-call honesty in the Arch forward thread.
# FlatNet / ComposedNet: same architecture, flat vs composed (arg-nesting that
# v1 EXTRACTS). ChainNet: a method chain that is still DETECTED but not
# extracted (the uncaptured backstop — must be badged, never silently
# complete), beside a comprehension that M-COMP now captures in a container.
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
    """The uncaptured backstop, and (since M-COMP) its boundary.

    METHOD CHAIN — `self.proj` sits in the callee position of `.relu()`.
    Nothing decomposes that, so the wrapping step must carry the dashed
    'uncaptured' badge and never read as silently complete. This is the
    case the backstop still exists for.

    COMPREHENSION — `self.head` used to be the second such case. It is not
    any more: a comprehension is a LOOP, so M-COMP gives it a container and
    its calls become real nodes inside it. `self.head` is now a visible
    step, repeated, and `torch.stack(...)` is no longer badged."""

    def __init__(self):
        super().__init__()
        self.proj = nn.Linear(16, 16)
        self.head = nn.Linear(16, 4)

    def forward(self, x):
        x = self.proj(x).relu()                            # chain: self.proj uncaptured
        x = torch.stack([self.head(x) for _ in range(2)])  # comprehension: self.head uncaptured
        return x
