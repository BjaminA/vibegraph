"""Net-type classifier fixture — one model per discriminating family, plus a
hybrid (reported as a mix, not collapsed) and an unrecognized model (low
confidence). forward() is one-call-per-line so layer order resolves.
"""

import torch
import torch.nn as nn


class MLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(784, 256)
        self.act = nn.ReLU()
        self.fc2 = nn.Linear(256, 10)

    def forward(self, x):
        x = self.fc1(x)
        x = self.act(x)
        x = self.fc2(x)
        return x


class CharRNN(nn.Module):
    def __init__(self, vocab=128, hidden=256):
        super().__init__()
        self.embed = nn.Embedding(vocab, hidden)
        self.lstm = nn.LSTM(hidden, hidden, batch_first=True)
        self.head = nn.Linear(hidden, vocab)

    def forward(self, x):
        x = self.embed(x)
        x = self.lstm(x)
        x = self.head(x)
        return x


class TextTransformer(nn.Module):
    def __init__(self, vocab=1000, d_model=256):
        super().__init__()
        self.embed = nn.Embedding(vocab, d_model)
        self.encoder = nn.TransformerEncoder(
            nn.TransformerEncoderLayer(d_model, 8), num_layers=4
        )
        self.head = nn.Linear(d_model, vocab)

    def forward(self, x):
        x = self.embed(x)
        x = self.encoder(x)
        x = self.head(x)
        return x


class ConvAttnNet(nn.Module):
    """Conv stem + attention — must be reported as a HYBRID, not collapsed."""

    def __init__(self):
        super().__init__()
        self.conv = nn.Conv2d(3, 64, 3)
        self.attn = nn.MultiheadAttention(64, 4)
        self.fc = nn.Linear(64, 10)

    def forward(self, x):
        x = self.conv(x)
        x = self.attn(x)
        x = self.fc(x)
        return x


class TinyViT(nn.Module):
    """Conv patch stem + transformer body. Attention dominates, so this must
    read as transformer (or hybrid) — NEVER a confident CNN off the stem."""

    def __init__(self):
        super().__init__()
        self.patch = nn.Conv2d(3, 64, 16, stride=16)
        self.attn1 = nn.MultiheadAttention(64, 8)
        self.attn2 = nn.MultiheadAttention(64, 8)
        self.attn3 = nn.MultiheadAttention(64, 8)
        self.head = nn.Linear(64, 10)

    def forward(self, x):
        x = self.patch(x)
        x = self.attn1(x)
        x = self.attn2(x)
        x = self.attn3(x)
        x = self.head(x)
        return x


class MysteryNet(nn.Module):
    """Only an unrecognized custom layer — net-type is unknown (low conf)."""

    def __init__(self):
        super().__init__()
        self.block = SomeCustomBlock(32)

    def forward(self, x):
        x = self.block(x)
        return x


class SomeCustomBlock(nn.Module):
    def __init__(self, dim):
        super().__init__()
        self.dim = dim
