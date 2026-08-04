# Example 2 — Build the pump lab from scratch

**The same project as [Example 1](../pump-wear), built from an empty
folder.** Example 1 shows what VibeGraph does with code that already
exists; this one shows the other half — describing what you want,
ratifying a plan, and watching it get built one verified increment at a
time.

Budget 20–30 minutes and a few dollars of Claude usage. Every stage is a
real `claude` call.

---

## 1. Get the data first

The build writes code that *reads* this file, so it has to exist before
you start.

```bash
cd examples/pump-from-scratch
cp ../pump-wear/data/pump.csv data/
```

Leave `data/holdout.csv` absent — Example 1's step 5C uses that gap.

## 2. Point VibeGraph at the empty folder

```bash
cd /path/to/VibeGraph
./runVis.sh examples/pump-from-scratch
```

Open <http://localhost:4200>. The canvas is empty apart from `data/`.
That is the point.

## 3. Describe what you want

Click **Describe** and paste this:

```
a pytorch MLP regressor that predicts pump wear from data/pump.csv
(header row; 8 float sensor features named vibration, temperature, load,
rpm, pressure, humidity, age_years, flow, then a float wear target): a
data module with a load function that reads the csv into train and test
tensors with an 80/20 positional split and standardizes BOTH the features
and the wear target using mean/std fitted on the training split only
(applied to train and test alike), a Standardizer class whose __init__
takes mean=0.0 and std=1.0 defaults with an apply method that returns the
standardized value and an invert method that undoes it, and a
target_stats function that reads the csv and returns the wear column's
mean and std; a model module with an 8 to 64 to 32 to 1 MLP with ReLU
whose __init__ declares self.net = nn.Sequential with every layer listed
literally, plus a build_model factory; a metrics module with a pure
r_squared function; a train module that runs minibatch epochs, prints
loss per epoch and final test R2, and saves the trained weights to
model.pt; and a predict module that loads model.pt and has a predict_wear
function, plus an evaluate_holdout function that reads data/holdout.csv
with the same 9-column schema and reports R2 on it
```

**Four clauses in that brief are load-bearing.** They are the difference
between a build that works and one that passes every gate and is wrong:

- *"standardizes BOTH the features and the wear target"* — without it the
  raw scales (features from 0.2 to 3000, target in the tens) tank R² below
  zero. The model trains, the checks pass, the number is bad.
- *"fitted on the training split only"* — the leaky version scores
  **better**. The correct one is the one that looks worse.
- *"every layer listed literally"* — `nn.Sequential(*layers)` cannot be
  enumerated statically, so the Arch view honestly collapses to one card.
  If you want the schematic, ask for the shape.
- *"8 float sensor features named …, then a float wear target"* — name the
  **format**, not just the fields. A build that invents its own CSV layout
  will write a check against that same invention and pass it. That is not
  hypothetical: it is how a trial build produced a CLI that printed empty
  tables and went green.

## 4. Ratify the architecture, then the roadmap

VibeGraph drafts a **system plan** — the subsystems and how they relate —
as a ghost overlay. Read it and **Approve & draft roadmap**, or use
**Modify** to redraft through the same floor. Nothing is on disk yet.

Then it drafts a **roadmap**: ordered capabilities, dependencies first,
each quoting the part of your description it is grounded in. A capability
that quotes nothing you actually said is marked **⚠ INFERRED** — read
those especially carefully. Ratify, and the build can start.

Both gates are human. That is the point of the pipeline: you approve a
plan before any code exists, instead of reviewing a finished pile.

## 5. Run the build and judge each gate

Click **Run roadmap**. Expect roughly 5 increments. For each one
VibeGraph drafts the code *and* a behavioural check, then stops at a gate
showing the files it wants to write, the check it wrote, and the check's
verdict.

- **Green** — read it, accept, move on.
- **Red** — the check failed. **Retry** re-drafts through the same floor,
  **Modify** revises the capability, **Discuss** opens the roadmap
  overview focused on that stage. A red floor or two is normal: capable
  models write checks stricter than their own first draft, and the Modify
  round-trip is how that resolves.

You will be asked to **consent** on the model and training stages. That is
the effect floor: a check that calls `model(x)` or writes `model.pt`
cannot be proven side-effect-free, so it stops and asks rather than
running quietly. Taking **Run & stop asking about unverifiable calls**
covers later torch calls; proven file/db/network effects keep asking.

When the run finishes, **collapse the roadmap panel** (the chevron next to
"Roadmap"). A ratified roadmap has no close button, and left open it
covers the lower-left canvas.

## 6. Train it

```bash
cd examples/pump-from-scratch
PYTHONPATH=/path/to/VibeGraph/.pydeps python3 train.py
```

**The bar: test R² ≥ 0.98.** A linear fit on this data reaches about 0.95,
so anything at or below that means the network isn't earning its keep —
check that both the features and the target got standardized.

If it lands well below zero, the target almost certainly wasn't
standardized. That is the first clause of the brief doing its job, or
failing to.

## 7. Now run Example 1's tour on your own build

Everything in [Example 1](../pump-wear/README.md#3-see-the-code-as-structure)
applies to what you just built: the launchpad groups, the Arch schematic,
the `model.pt` seam, the three run-to-here drills, chat edits through the
CST chokepoint, skills, agents.

Names will differ — the builder picks them. Read the launchpad rows rather
than grepping for the names Example 1 uses.

---

## What differs from Example 1

Example 1 hands you a finished codebase so you can see the *exploration
and editing* half immediately. This one exercises *planning and
verification*: a ratified architecture, a grounded roadmap, and a
per-increment floor with an effect gate.

Your build will not be byte-identical to Example 1's. Same brief, same
floors — but the model writes what it writes, which is exactly why the
gates and the checks are there.

**One thing a green build does not prove.** A behavioural check verifies
self-consistency, not conformance to reality. If the brief is vague about
a format, the builder invents one and writes its check against that same
invention — and passes. Every clause in step 3 marked load-bearing is
there because a trial build got it wrong.
