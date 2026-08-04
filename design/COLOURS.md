# VibeGraph colour system

Phase 4 lock. One sentence per token, one row per place a token is allowed
to be used. Outside this table is a bug.

All colours live in `src/webview/styles/tokens.css`. No raw hex anywhere
else in the codebase — every reference is `var(--token)` or a `color-mix()`
expression on a token. The motion easings, spacing scale, and shadow tokens
follow the same rule (see PLAN.md §Aesthetic Appendix).

## Semantic tokens

| Token | HSL | Semantic meaning | Allowed users |
|---|---|---|---|
| `--bg-canvas` | `220 14% 8%` | Document background | `html`, `body`, ReactFlow canvas, Monaco editor.background |
| `--bg-node` | `220 12% 12%` | Default node fill | Every node card body, panel bodies |
| `--bg-node-hover` | `220 12% 16%` | Selected/active state | Monaco selection background, hover overlays |
| `--border-edge` | `220 10% 22%` | Subtle borders | Node card borders, panel borders, dividers |
| `--text-primary` | `220 14% 92%` | Foreground text | Body text, code text, keywords in Monaco |
| `--text-secondary` | `220 10% 64%` | De-emphasised text | Identifiers, lighter labels, control edges, return-stmt accent |
| `--text-muted` | `220 8% 44%` | Background labels, hints | Comments, mutes, kbd hints, contains-edge stroke |
| `--accent-thread` | `168 60% 56%` (teal) | **Structure: functions, classes, references** | FunctionDef + ClassDef accents, reference edges, thread highlights, M5 string-literal Monaco scope |
| `--accent-warning` | `38 80% 60%` (yellow) | **Data: literals, numbers, type info** | Number/string/dict values, data edges, badge metadata |
| `--accent-error` | `358 70% 60%` (red) | **Errors / exceptions ONLY** | RaiseNode, run-output errors in NodeActionBar, stub validation errors |
| `--accent-io` | `280 50% 65%` (violet) | **I/O operations** (Phase 4) | CallNode when `isEffect` is true (print, write, flush, close), TerminalIcon default |
| `--accent-chat` | `267 84% 81%` (lavender) | Chat panel accent | ChatPanel only |
| `--accent-compose` | `20 92% 75%` (peach) | Compose palette accent | ComposePalette only |

## Type-discriminator tokens (badge icons in `icons.tsx`)

These preserve per-Python-type colour identity for the value-kind badges
(int, float, list, etc.). They're metadata, not affordance — Phase 5
demotes them to lower opacity at small size.

| Token | HSL | Type |
|---|---|---|
| `--type-float` | `20 91% 53%` | float / int badge |
| `--type-list` | `160 64% 52%` | list literal |
| `--type-tuple` | `141 79% 73%` | tuple literal |
| `--type-dict` | `257 90% 76%` | dict literal |
| `--type-set` | `272 95% 75%` | set literal |
| `--type-call` | `213 94% 68%` | call expression badge |

String / f-string reuse `--accent-warning`. Function / class / package
reuse `--accent-thread`. None reuses `--text-secondary`. Terminal reuses
`--accent-io` (was `--accent-error` pre-Phase 4 — that was the misuse the
audit caught).

## Edge type semantics

Pinned in `src/webview/layout/edges.ts`. Stroke colour + stroke pattern
+ stroke width all carry meaning.

| Edge type | Stroke token | Width | Pattern | Meaning |
|---|---|---|---|---|
| `contains` | `--text-muted` | 1px (opacity 0.5) | solid | Structural parent → child |
| `control` | `--text-secondary` | 1.5px | solid | Reserved for branch flow |
| `data` | `--accent-warning` | 2px | dashed `4 2` | Iterable / value flows in |
| `reference` | `--accent-thread` | 1.5px | dashed `2 2` | Call site / inheritance / cross-file ref |

There is **no green dashed edge**. The teal accent's `2 2` dashes can read
slightly green at small zoom against the canvas background, but that's
hue perception drift, not a separate edge type. If a second teal-adjacent
edge type is ever needed, it gets its own token; we do not split by
saturation alone.

## Pink-check for `--accent-io`

Hue 280° at 50% sat / 65% light renders distinctly violet at every size
tested (badge 16px, icon 24px, edge stroke 1.5px, fill tint 6%). If a
future zoom level or display makes it pink, drop saturation 5–10 points
before shifting hue — moving toward 270° pushes it bluer, moving toward
290° pushes it redder.

## Audit rule

Adding a new colour token requires a row in this file. Using a token
outside its allowed-users column is a bug. Raw hex anywhere outside
`tokens.css` is also a bug (caught at review).
