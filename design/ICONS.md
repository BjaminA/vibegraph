# VibeGraph icons

Phase 5 audit. Every icon must pass the three-word test: state its action
or identity in three words or fewer. Failing that, it goes.

## Action-strip icons (`NodeActionStrip.tsx`)

Four buttons, top-right of every node card.

| Icon | Three-word action | Verdict |
|---|---|---|
| Pencil (`edit`) | "Edit this node" | Keep. Routes to `cst_rewrite.py` via WS `edit-node-open`. |
| Sparkle (`chat`) | "Modify with Claude" | Keep. Routes to ChatPanel with this node as context. |
| Chevron (`expand`) | "Expand this node" | Keep — Phase 2 addition, replaces the planned "show source preview" affordance. |
| Eye-slash (`hide`) | "Hide this node" | Keep. Toggles inclusion in `hiddenNodeIds` filter. |

All four are uniformly 22×22, 5px corner radius, 1.5 stroke weight,
positioned absolutely at `top:5 right:5` of every node card. Reserve
space via `--node-action-reserve` (108px).

## Identity icons (`icons.tsx`)

These ARE the visual identity of a node type, not affordances. They live
inside the node header band, not the action strip.

| Icon | Identity | Verdict |
|---|---|---|
| `NumberIcon` | "Float / int value" | Keep. Now glyph-only ("1.0"); the "float" subtitle was redundant against the colour ring. |
| `StringIcon` | "String literal" | Keep. The serif `"A"` IS the icon. |
| `FStringIcon` | "F-string literal" | Keep. The `f"` glyph + lightning bolt convey dynamic interpolation. |
| `ListIcon` | "List literal" | Keep. Square brackets with rows. |
| `DictIcon` | "Dict literal" | Keep. Curly braces with `k:` pairs. |
| `TupleIcon` | "Tuple literal" | Keep. Round brackets with dots. |
| `SetIcon` | "Set literal" | Keep. Circle with three dots. |
| `CallValueIcon` | "Call expression" | Keep. Parens with arrow. |
| `OtherValueIcon` | "Other value" | Keep. Dashed circle with three dots — the "unknown" placeholder. |
| `FunctionIcon` | "Function def" | Keep. Italic ƒ glyph. |
| `ClassIcon` | "Class def" | Keep. Geometric class marker. |
| `PackageIcon` | "Import / package" | Keep. Box with arrow. |
| `TerminalIcon` | "I/O call" (Phase 4) | Keep. Now violet via `--accent-io`, was misusing `--accent-error`. |
| `ReturnArrow` | "Return value" | Keep. Right-arrow with shaft. |
| `PortDot` | "Connection port" | Keep. Hangs off node edges, decorative. |
| `ValueKindIcon` | Dispatcher | Keep — picks the right icon by `valueKind`. |

## Demoted: redundant text labels

The mini text-tag inside `AssignmentNode`'s header (`"f-string"`,
`"number"`, etc.) reads as an affordance at full opacity. Demoted to
0.5 opacity per the Phase 5 refinement — same content, lower visual
weight. Treated as metadata, not interactive label.

If a future user-test shows the label is still noise at 0.5, the next
step is removal (the icon + colour already discriminate type).

## Removed in Phase 5

- The "float" subtitle inside `NumberIcon`. The "1.0" glyph and colour
  ring already identify the kind. The subtitle was a redundant fifth
  signal.

## Three-word test for any future icon

Before adding:

1. State its action or identity in ≤ 3 words. If you can't, it doesn't
   belong in the strip.
2. Confirm it doesn't duplicate an existing icon's job.
3. Confirm there is a sensible event payload (`vg-*` custom event or
   inline state mutation).

Action icons live in `NodeActionStrip.tsx` and are 22×22. Identity icons
live in `icons.tsx` and are 22×22 (interior glyphs scale within).
