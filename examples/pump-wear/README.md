# Example 1 — Pump wear (start here)

**A finished PyTorch project, so you can use VibeGraph immediately.** An
MLP predicts a pump's wear score from 8 sensor readings. Five small files,
one linear call chain, and — deliberately — one thing that is missing, one
thing that isn't built yet, and one function nothing calls.

Budget 20–30 minutes. Steps 1–4 need no Claude usage; steps 6–8 make real
`claude` calls.

Want the other half — describing a project and watching it get built?
[Example 2](../pump-from-scratch) builds this same brief from an empty
folder.

---

## 1. The data is already here

`data/pump.csv` — 400 rows, 9 columns: 8 sensor features then the `wear`
target. It is generated (`make_pump_data.py`, fixed seed) so it is
regenerable and identical for everyone:

```bash
cd examples/pump-wear
python3 make_pump_data.py     # only if you want to regenerate it
```

`data/holdout.csv` is **deliberately absent**. Step 7 uses that.

## 2. Open it in VibeGraph — before training

```bash
cd /path/to/VibeGraph
./runVis.sh examples/pump-wear
```

Open <http://localhost:4200>.

Do **not** train yet. The untrained state is half of a demo in step 4.

## 3. See the code as structure

The launchpad groups entry points by what they are:

| group | rows |
| --- | --- |
| **MODEL** | `WearMLP.forward` — tagged **pytorch** |
| **CLI** | `main`, `evaluate_holdout` |
| **PUBLIC API** | `load`, `read_rows`, `target_stats`, `r_squared`, `build_model` |

Things worth doing here:

- **Open `main`.** One thread, left to right: load → build → train loop →
  score → save. Containers (the epoch loop, the batch loop) wrap their
  children rather than flattening.
- **Arch view.** The 8→64→32→1 stack as a schematic with parameter counts.
  It reads that way because `model.py` lists every layer literally inside
  `nn.Sequential`. A model that builds layers in a loop and splats them
  (`nn.Sequential(*layers)`) cannot be enumerated statically, and the view
  honestly collapses to a single card instead of guessing.
- **`predict_wear` has no launchpad row,** and that is correct rather than
  a gap. The launchpad lists *entry points* — roots of execution.
  `predict_wear` is called only from inside `predict.py`, so it appears as
  a **step within `evaluate_holdout`'s thread**, not as a row of its own.
  To give it one: Files → `predict.py` → hover it → **pin** ("Start a
  thread from here") and it becomes a manual launchpad row.

## 4. The trained / untrained seam

- Open **CLI → `evaluate_holdout`** and click the **`model.pt · missing`**
  chip in the top-left strip.
- The Artifacts card says **missing (not yet produced)**, names the thread
  that *would* produce it (`train:main`) with the save site cited, offers
  **Open producer thread**, and lists each consumer once.

Everything on that card is static — no run required to know what produces
`model.pt` and who reads it.

Now train it:

```bash
cd examples/pump-wear
PYTHONPATH=/path/to/VibeGraph/.pydeps python3 train.py
```

Expect **test R² ≈ 0.985** (~60 epochs, a few seconds on CPU). The run also
prints the wear column's mean and std, so you can read the error in wear
units instead of standardized ones.

Re-open the chip: it now reads **present**, with freshness (`model.pt ·
just now`). That before/after *is* the seam.

## 5. Three run-to-here drills

Run-to-here executes the real code up to one node and shows you the value
that node produced. Long threads run off-screen to the right — zoom out or
use the minimap.

### A — a value from real input

- **PUBLIC API → `target_stats`** → hover its `return` → **run-to-here**.
- The fs-read gate asks first. Reading a file is a *proven* effect, so it
  always asks — session trust never covers it. Confirm.
- Captured value: **`return = (34.14431625, 21.84908594845013)`**,
  provenance *"ran with real input"*. Those are the real mean and std of
  the wear column.

### B — a synthesized instance

- `Standardizer.apply` *is* called — `load()` uses it — so it shows up as
  a step inside other threads. But it is not an entry point, so it has no
  thread of its own, and running it there would just be part of a real
  run. To run it **in isolation**, pin it: Files → `data.py` → hover
  `apply` → **pin** → **Open thread**.
- Run-to-here on its `return`. Now there is no instance to run the method
  on, so VibeGraph proposes one built from the literal defaults in
  `__init__`:
  **`_obj = Standardizer(mean=0.0, std=1.0)`**, plus an editable `value`.
- Confirm. The captured value comes back with the fabricated premise
  named.

  **The default `Standardizer` is the identity transform** (`mean=0.0,
  std=1.0`), so `apply(12.5)` returns `12.5` — the value passes through
  unchanged. That is the code being honest, not the tool failing. Edit the
  proposed `mean` to `34.14` and re-run: the number changes. The proposal
  is editable precisely so you can do that.

### C — a synthesized input file

This one needs `model.pt` to exist, so do step 4 first.

- **CLI → `evaluate_holdout`** → find the R² step near the thread's right
  end → **run-to-here**.
- The effect gate lists the fs read plus unverifiable torch calls →
  **Run with side effects**.
- It **fails honestly**: `data/holdout.csv` doesn't exist. You get
  **Ask Claude to draft an example file** and "Ask Claude about this error"
  (which prefills the chat and never auto-sends).
- Take the draft offer. The drafted CSV must match the real **9-column**
  schema with the same header — `evaluate_holdout`'s docstring states it
  and the code path shows it. A 5-column guess would be a bug. It is shown
  in full, and your consent is bound to its content hash.
- Confirm → the run happens in a throwaway copy of the project → a real
  captured value, with the premise named: *"ran with synthesized input:
  example file data/holdout.csv (N lines) · in a throwaway copy of your
  project"*.

  **The R² number itself is meaningless** — possibly negative. The rows
  were fabricated. That is exactly what the premise line is for. Your real
  `data/` is untouched.

Honesty rules you can check while you are here: the run button only
appears on nodes that structurally produce a value; every synthetic run
names its fabricated premise; the consent row stays reachable no matter
how long the effect list is.

## 6. Change it, and watch the graph follow

Scenario: *add dropout so the net generalizes.*

- Files → `model.py` → click `WearMLP.__init__`. The code dock opens and
  the chat docks under it with a **`◈ __init__`** context chip.
- Ask: *"add a Dropout(0.2) after the first hidden layer's ReLU"*.
- Watch the re-linking pulse. The reply cites the structural node ids it
  changed. Every edit routes through the CST chokepoint — no line splicing,
  and an edit that would touch lines outside the target node is rejected
  with a human-worded reason and nothing is written.
- **Arch view**: the Dropout glyph now sits in the forward path.

For comparison, the editor path: click `forward` → Monaco → edit → **Save**.

If you add dropout, note that `train.py` already calls `model.eval()`
before scoring. `torch.no_grad()` disables gradients but does *not* switch
dropout off — without `eval()` your test R² would wobble between runs for
no real reason.

## 7. Skills — teach it about a thread, once

- Open the training thread → **Skill** chip (reads `No skill`) → **Draft
  skill** → read it → **Ratify**.
- The chip turns green and reads **`Skill`**. `Skill · draft` means it is
  not ratified — drafting is automatic, ratifying is human, always.
- **Go back to the launchpad**, then ask the chat a question naming a
  training-thread function in backticks — e.g. *"why does `run_training`
  shuffle with a seeded generator each epoch?"*
- Expect a muted `routed:` line naming the thread, the token that matched,
  and that the ratified skill was shared. Routing deliberately skips the
  thread you are standing in — its skill already rides your turn — so ask
  from the launchpad, not from inside the thread.

When a skill *isn't* shared, the line says why (unratified / stale /
over-budget / already shared). A bare line with no reason is a bug.

## 8. Agents

Spawn a thread agent on `train:main` and give it a task. Its context is
bounded to that one thread: the execution projection, the ratified skill,
the blind-spot roll-up, and the adjacent threads it can see but is not
scoped to.

It is a **one-shot reasoning agent with no tools** — it cannot run, test,
or grep, and it is instructed never to claim it did. Treat its numeric
claims as hypotheses and its structural claims as checkable against the
IR. If it needs something outside its thread it returns `ESCALATE:` rather
than guessing.

---

## What to take away

Every number in this example is either real or explicitly labelled as
fabricated, and the labelling travels with the value rather than sitting
in a footnote. `model.pt · missing` is knowable without running anything.
The holdout R² is garbage and says so. `Standardizer.apply` returns its
input unchanged and the tool doesn't pretend otherwise.

That is the whole design: **you should never have to guess whether what
you are looking at is true.**
