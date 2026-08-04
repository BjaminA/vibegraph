// Stub `claude -p --output-format json`: emits a contract-shaped VibeReadme.
const body = `## What this is
A PyTorch regression project that predicts pump wear from eight sensor readings.

## How it is organised
- \`data.py\` — CSV loading, the positional split, and the Standardizer.
- \`model.py\` — the WearMLP network and its build_model factory.
- \`metrics.py\` — a dependency-free r_squared.
- \`train.py\` — the training loop and the saved weights.
- \`predict.py\` — scoring, including evaluate_holdout.

## Entry points
- model: WearMLP.forward
- cli: train.py:main, predict.py:evaluate_holdout
- public api: load, read_rows, target_stats, r_squared, build_model

## External surface
Reads \`data/pump.csv\`, writes \`model.pt\`, prints to stdout.

## Not statically known
Tensor shapes and dtypes at runtime; whether model.pt matches the current
architecture; anything reached through torch's dynamic dispatch.`;
process.stdout.write(JSON.stringify({ result: body }));
