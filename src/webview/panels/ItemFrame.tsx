// One frame for every item a panel lists — a planned process, store, flow,
// thread, planned rule or question, a stated rule (GUI brief M4):
//   1. a header line: the item's chip, its name, badges on the right; no prose
//   2. at most THREE labelled bullets, each one line of text or chips
//   3. the long reading folded in a <details> ("Why realised · 14 files")
//   4. the actions the item allows
// The conciseness is enforced HERE, not left to whoever writes the item:
// bullets past three move into the fold, a chip list past three shows three
// and "+N", a bullet clamps at two lines with its full text on hover, and
// there is no italic prose above the fold.

import React from "react";
import type { ChipRef, ItemFact } from "../../shared/kinds";
import { Chip, Parts } from "./Chip";

export const MAX_BULLETS = 3;
export const MAX_CHIPS = 3;

/** A bullet's parts with at most MAX_CHIPS chips; the rest counted. */
export function capParts(parts: Array<ChipRef | string>): { shown: Array<ChipRef | string>; more: number } {
  const shown: Array<ChipRef | string> = [];
  let chips = 0, more = 0;
  for (const p of parts) {
    if (typeof p !== "string" && chips >= MAX_CHIPS) { more++; continue; }
    if (typeof p !== "string") chips++;
    shown.push(p);
  }
  // A verb left dangling after the cut says nothing.
  while (more && typeof shown[shown.length - 1] === "string") shown.pop();
  return { shown, more };
}

const plain = (f: ItemFact): string =>
  f.text ?? (f.parts ?? []).map((p) => (typeof p === "string" ? p : p.label ?? p.id)).join(" ");

function Bullet({ f }: { f: ItemFact }) {
  const capped = f.parts ? capParts(f.parts) : null;
  return (
    <li data-item-bullet={f.label}>
      <b>{f.label}</b>
      <span title={plain(f)}>
        {capped ? <><Parts parts={capped.shown} />{capped.more ? <span data-item-more style={{ color: "var(--text-muted)" }}>{` +${capped.more}`}</span> : null}</> : f.text}
      </span>
    </li>
  );
}

export function ItemFrame({ chip, name, badges, facts = [], details, actions, children, ...rest }: {
  chip?: ChipRef;
  name?: string;
  badges?: React.ReactNode;
  facts?: ItemFact[];
  /** a block the item must show above the fold (a proposal's before / after) */
  children?: React.ReactNode;
  /** the fold: its summary line and what it holds */
  details?: { summary: string; body: React.ReactNode } | null;
  actions?: React.ReactNode;
  [data: `data-${string}`]: string | undefined;
}) {
  const shown = facts.filter((f) => f.text || f.parts?.length).slice(0, MAX_BULLETS);
  const overflow = facts.filter((f) => f.text || f.parts?.length).slice(MAX_BULLETS);
  const fold = details || overflow.length ? (
    <details data-item-details>
      <summary>{details?.summary ?? `${overflow.length} more`}</summary>
      {overflow.length > 0 && <ul style={{ padding: "4px 0 0" }}>{overflow.map((f, i) => <Bullet key={i} f={f} />)}</ul>}
      {details?.body}
    </details>
  ) : null;
  return (
    <article className="vg-item" {...rest}>
      <div className="vg-item-head">
        {chip && <Chip {...chip} />}
        {name && <span className="vg-item-name">{name}</span>}
        <span className="vg-grow" />
        {badges}
      </div>
      {shown.length > 0 && <ul>{shown.map((f, i) => <Bullet key={i} f={f} />)}</ul>}
      {children}
      {fold}
      {actions ? <div className="vg-item-acts">{actions}</div> : null}
    </article>
  );
}
