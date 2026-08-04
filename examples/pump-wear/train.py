"""Train the pump-wear regressor and save its weights to model.pt."""

import torch
import torch.nn as nn

from data import load, target_stats
from metrics import r_squared
from model import build_model

EPOCHS = 60
BATCH_SIZE = 32
WEIGHTS_PATH = "model.pt"


def run_training(model, train_x, train_y, epochs=EPOCHS, batch_size=BATCH_SIZE):
    """Minibatch training loop. Returns the model, trained in place.

    The generator is seeded so two runs of this example produce the same
    numbers — a demo whose output moves every run makes it impossible to
    tell a real change from noise.
    """
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01)
    loss_fn = nn.MSELoss()
    generator = torch.Generator().manual_seed(0)

    for epoch in range(epochs):
        order = torch.randperm(len(train_x), generator=generator)
        epoch_loss = 0.0
        for start in range(0, len(order), batch_size):
            batch = order[start:start + batch_size]
            optimizer.zero_grad()
            predictions = model(train_x[batch])
            loss = loss_fn(predictions, train_y[batch])
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()
        if (epoch + 1) % 10 == 0:
            batches = (len(order) + batch_size - 1) // batch_size
            print(f"epoch {epoch + 1}/{epochs}  loss {epoch_loss / batches:.4f}")
    return model


def main():
    """Load, train, score on the held-out split, save weights."""
    torch.manual_seed(0)
    train_x, train_y, test_x, test_y, target_scaler = load()

    model = build_model()
    run_training(model, train_x, train_y)

    # eval(): the model has no dropout today, but no_grad() disables
    # gradients only — it would NOT switch dropout off if one were added.
    model.eval()
    with torch.no_grad():
        test_predictions = model(test_x)

    score = r_squared(test_predictions.reshape(-1), test_y.reshape(-1))
    mean_wear, std_wear = target_stats()
    print(f"test R2 {score:.4f}")
    print(f"wear column: mean {mean_wear:.4f}  std {std_wear:.4f}")

    torch.save(model.state_dict(), WEIGHTS_PATH)
    print(f"saved weights to {WEIGHTS_PATH}")


if __name__ == "__main__":
    main()
