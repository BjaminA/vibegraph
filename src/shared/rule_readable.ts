// A stated rule as a person reads it (2026-10-22, Ben, on the Rules panel:
// "they are not very user readable friendly - seems more like meta data").
// A drafted rule carries its reason inside its text, "(why: …)", which is what
// a hooked Claude Code session is sent, and a note in the drafting gate's own
// terms (rule_draft_gate.ts: "proposed from the architecture (model); rests on
// <fact ids> — <what the gate did>"). The stored rule is unchanged: this splits
// it for the panel into the statement, its reason, the sentence it came from,
// whether VibeGraph checks it, and who proposed it, keeping the fact ids for
// the details. Webview-safe and pure.

export interface RuleLike {
  text: string;
  note?: string;
  source?: string;
  cite?: { file: string; line: number; quote: string } | null;
  /** the rule has a check (or a policy) VibeGraph runs */
  checked?: boolean;
}

export interface ReadableRule {
  statement: string;
  why: string | null;
  /** the sentence the rule was read from */
  quote: { where: string; text: string } | null;
  /** whether VibeGraph checks it, in plain words; null when its check row says so */
  check: string | null;
  /** who proposed it and who decided it */
  source: string | null;
  /** the facts a drafted rule rests on, in words */
  basedOn: string[];
  /** anything else the note said, in words */
  notes: string[];
  /** the model that drafted it, for the details */
  model: string | null;
}

const WHY = "(why:";

/** The statement and its reason, from a text that ends "(why: …)". */
export function splitWhy(text: string): { statement: string; why: string | null } {
  const t = text.trim();
  const i = t.lastIndexOf(WHY);
  if (i < 0 || !t.endsWith(")")) return { statement: t, why: null };
  return { statement: t.slice(0, i).trim(), why: t.slice(i + WHY.length, -1).trim() || null };
}

const FACT_WORDS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^crossing:\d+$/, () => "a hop between processes"],
  [/^funnel:(.+)$/, (m) => `${m[1]}, the module the calls go through`],
  [/^tool:(.+)$/, (m) => `the ${m[1]} tool`],
  [/^boundary:(.+)$/, (m) => `calls leaving through ${m[1]}`],
  [/^harvest:(.+)$/, (m) => `the sentence at ${m[1]}`],
  [/^zone:(.+)$/, (m) => `the ${m[1]} data zone`],
  [/^rule:(.+)$/, (m) => `rule ${m[1]}`],
  [/^group:(.+)$/, (m) => `the ${m[1]} group`],
  [/^cluster:(.+)$/, (m) => `the ${m[1]} box`],
  // the direction census (project_direction.ts): patterns the code already follows
  [/^direction:funnel:(.+)$/, (m) => `the code's habit of reaching ${m[1]} through one module`],
  [/^direction:(.+)$/, (m) => `a pattern the code already follows (${m[1]})`],
];

/** Fact ids (`crossing:3`, `funnel:x`) in words, the same kind counted once. */
export function factsInWords(ids: string[], more = 0): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const hit = FACT_WORDS.map(([re, f]) => { const m = id.match(re); return m ? f(m) : null; }).find(Boolean) ?? id;
    counts.set(hit, (counts.get(hit) ?? 0) + 1);
  }
  const out = [...counts].map(([w, n]) => (n === 1 ? w : w === "a hop between processes" ? `${n} hops between processes` : `${w} (${n})`));
  if (more) out.push(`${more} more`);
  return out;
}

const DRAFTED = /^proposed from the architecture \(([^)]*)\); rests on (.*?)(?: — ([\s\S]*))?$/;
const NOTE_START = /; (?=its check was removed|VIOLATED on the current code|dropped from the scope|its claim was corrected|narrowed to |a claim (?:could not|was dropped)|its claims were not|it states what the code does|its check was replaced|its check comes from what the funnel|its check cannot catch)/;

/** One of the drafting gate's notes, in plain words: the check, or another note. */
function noteInWords(n: string): { check?: string; note?: string } {
  const undecidable = /^its check was removed: it cannot be decided on this code \(([\s\S]*?)\)?$/.exec(n);
  if (undecidable) {
    const reason = undecidable[1].replace(/\bthe IR knows\b/g, "VibeGraph's map of the code has").replace(/\bthe IR\b/g, "VibeGraph's map of the code");
    return { check: `Not checked automatically: ${reason}, so a check could only ever say it cannot tell. Claude Code is told the rule; no edit is blocked by it.` };
  }
  const shape = /^its check was removed: not one of the grammar's shapes \(([^)]*)\)/.exec(n);
  if (shape) return { check: `Not checked automatically: the check proposed with it (${shape[1]}) is not one VibeGraph can run. Claude Code is told the rule; no edit is blocked by it.` };
  if (n.startsWith("its check was removed: ")) return { check: `Not checked automatically: ${n.slice("its check was removed: ".length)}.` };
  if (n.startsWith("VIOLATED on the current code: ")) return { check: `Checked, and the code breaks it today: ${n.slice("VIOLATED on the current code: ".length)}.` };
  // RC1 — a drafted rule's claims about the code (src/server/rule_draft_claims.ts)
  const undecided = /^a claim could not be decided on this code, so it is not checked: ([\s\S]*)$/.exec(n);
  if (undecided) return { check: `Not checked automatically: what it says the code does could not be decided on this code (${undecided[1]}). Claude Code is told the rule; no edit is blocked by it.` };
  if (n === "it states what the code does, and nothing checked it against the code") return { check: "Not checked automatically: it says what the code does, and nothing has checked that against the code. Claude Code is told the rule; no edit is blocked by it." };
  if (n === "its claim was corrected from the code") return {};
  // RC4 — a funnel rule's check, derived from what the funnel calls (src/server/funnel_checks.ts)
  if (n === "its check comes from what the funnel calls") return { note: "Its check comes from what the funnel calls: only the funnel may call those functions." };
  const replaced = /^its check was replaced: ([\s\S]*); it is checked by what the funnel calls instead$/.exec(n);
  if (replaced) return { note: `Claude's check could not catch a bypass (${replaced[1]}), so the check comes from what the funnel calls.` };
  if (n.startsWith("its check cannot catch a bypass: ")) return { check: `Checked, but this check cannot catch a bypass: ${n.slice("its check cannot catch a bypass: ".length)}.` };
  const narrowed = /^narrowed to (.*?): ([\s\S]*) breaks it$/.exec(n);
  if (narrowed) return { note: `Narrowed by the code to ${narrowed[1]}, the files that keep it: ${narrowed[2]} breaks it.` };
  if (n.startsWith("dropped from the scope: ")) return { note: `Left out of its scope, as this project has none of them: ${n.slice("dropped from the scope: ".length)}.` };
  return { note: n };
}

/** The sentence of a quote that is most about the rule, at most 300 characters. */
export function bestSentence(quote: string, about: string): string {
  const clean = quote.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z"'`(])/).map((s) => s.trim()).filter(Boolean);
  const words = new Set((about.toLowerCase().match(/[a-z0-9_.-]{4,}/g) ?? []));
  const score = (s: string) => (s.toLowerCase().match(/[a-z0-9_.-]{4,}/g) ?? []).filter((w) => words.has(w)).length;
  const best = sentences.length > 1 ? sentences.reduce((a, b) => (score(b) > score(a) ? b : a)) : clean;
  return best.length > 300 ? `${best.slice(0, 297).replace(/\s+\S*$/, "")}…` : best;
}

const PROPOSAL = /^proposed from the architecture \(([^)]*)\); rests on (.*?); (VIOLATED|passes) on the current code$/;

/** The reason given for a check proposed on a stated rule, in plain words. */
export function proposalWhyInWords(why: string): string {
  const m = PROPOSAL.exec(why.trim());
  if (!m) return why;
  const plus = /^(.*?) \+(\d+)$/.exec(m[2]);
  const facts = factsInWords((plus ? plus[1] : m[2]).split(/,\s*/).filter(Boolean), plus ? Number(plus[2]) : 0);
  return `Claude proposes this check from the project's architecture, based on ${facts.join(", ")}. ${m[3] === "VIOLATED" ? "The code breaks it today." : "The code passes it today."}`;
}

export function readableRule(c: RuleLike): ReadableRule {
  const { statement, why } = splitWhy(c.text);
  const quote = c.cite?.quote ? { where: `${c.cite.file}:${c.cite.line}`, text: bestSentence(c.cite.quote, `${statement} ${why ?? ""}`) } : null;
  const decided = c.source === "human" ? "; you ratified it" : c.source === "agent" ? "; it waits for you to ratify it" : "";
  const drafted = c.note ? DRAFTED.exec(c.note.trim()) : null;
  let check: string | null = null;
  const notes: string[] = [];
  let basedOn: string[] = [];
  let source: string | null = null;
  let model: string | null = null;
  if (drafted) {
    model = drafted[1] || null;
    const rests = drafted[2].trim();
    const plus = /^(.*?) \+(\d+)$/.exec(rests);
    basedOn = factsInWords((plus ? plus[1] : rests).split(/,\s*/).filter(Boolean), plus ? Number(plus[2]) : 0);
    source = `Proposed by Claude from the project's architecture${decided}.`;
    for (const n of (drafted[3] ?? "").split(NOTE_START).map((s) => s.trim()).filter(Boolean)) {
      const w = noteInWords(n);
      if (w.check) check = w.check;
      if (w.note) notes.push(w.note);
    }
  } else {
    if (c.note) notes.push(c.note);
    if (c.source === "agent") source = "Stated by Claude; it waits for you to ratify it.";
  }
  if (!check && !c.checked) check = "Not checked automatically: Claude Code is told the rule; no edit is blocked by it.";
  return { statement, why, quote, check, source, basedOn, notes, model };
}
