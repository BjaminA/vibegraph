// B2–B4 — THE ONE CALL (2026-10-08). The model is shown the facts pack
// (brief_facts.ts) and the vocabulary, and returns ONE JSON: the spec
// (function / method / features, each line with its data claims), group
// changes and names, scopes for the silent boxes, a start-here path, and what
// it left out. `only` asks for one section (a scopes batch, or a re-brief of
// stale spec lines). With `notes` (brief again with notes) the brief as it
// stands is shown too, and every note must be answered. The rules it is told
// are the ones brief_checks.ts enforces — telling them is cheaper than
// refusing the lines afterwards.

import type { BriefFacts } from "./brief_facts.ts";
import { ABSOLUTE_WORDS } from "./brief_checks.ts";
import { BRIEF_LIMITS, CLAIM_VERBS, type BriefBody, type BriefVocabulary } from "../shared/brief_types.ts";
import type { Vocabulary } from "../shared/node_io.ts";
import { GROUP_KINDS } from "./arch_store.ts";

export type BriefOnly = "spec" | "groups" | "scopes" | "path";

export function buildBriefPrompt(facts: BriefFacts, vocab: BriefVocabulary, opVocab: Vocabulary, opts: { only?: BriefOnly; guidance?: string; restate?: string[]; current?: BriefBody["spec"] | null; absolutes?: string[] } = {}): string {
  const want = (s: BriefOnly) => !opts.only || opts.only === s;
  const words = (part: keyof Omit<BriefVocabulary, "version">) => Object.entries(vocab[part]).map(([w, m]) => `  ${w} — ${m}`).join("\n");
  const abs = [...ABSOLUTE_WORDS, ...(opts.absolutes ?? [])];
  const L: string[] = [
    "You are writing the BRIEF of a codebase: a short, cited account of what it is for, how it holds together, and its key features.",
    "Below are FACTS derived from the code at zero cost (boxes, edges, data zones, processes, rules, where rules are applied, the declared topology, the plan, the project's docs). They are the only evidence you may cite.",
    "",
    "RULES — a line that breaks one is refused or marked, never kept as written:",
    "- Every claim CITES ids from the facts: a box or edge id, `rule:<id>`, `plan:…`, `topology:…`, `spec:…`, `note:<n>` or `file:line`. Cite only ids listed below. A claim with no valid citation is marked INFERRED.",
    "- Every spec line uses at least one WORD from its part of the vocabulary below, in `words`. A word not listed is refused.",
    "- EVIDENCE HAS A ROLE. [enforce] is where a rule is applied (a guarded function, a grant); [verify] is a test, probe, demo or refused attempt — it shows a mechanism WORKS and is never the mechanism. A METHOD line cites at least one [enforce] or running ([use]) item; one resting only on [verify], rules, the plan or docs is refused. Never describe a mechanism by its test.",
    `- DATA CLAIMS ARE CHECKED. Whenever a line says a box writes, reads, watches, creates or owns a zone, write it ALSO in \`claims\`: {"subject": "<box id>", "verb": "${CLAIM_VERBS.join("|")}", "object": "<zone id from DATA>", "partition": ["<key>", …]?, "not": true?}. A claim the DATA section contradicts refuses its line. A PARTITIONED zone has no single owner: say whose partition. Use "not": true for a claim of absence ("writes nothing": object "*").`,
    `- ABSOLUTE WORDS (${abs.join(", ")}) need a stated rule that says them — cite it — or a "not" claim the map confirms. Otherwise leave the word out.`,
    "- A line about a process states its PRIMARY operation (PROCESSES), never a secondary one as its main job.",
    "- COVER every [human] STATED RULE (cite it in a line, or name it in `omitted` with why), every SALIENT MECHANISM, and every process's primary operation (or name it in `omitted`).",
    "- A box's own id is not evidence for a claim about naming that box.",
    "- Each method line names the boxes it happens in (`boxes`, ids from BOXES), so a reader can see where.",
    `- Keep it short: at most ${BRIEF_LIMITS.function} function lines, ${BRIEF_LIMITS.method} method lines, ${BRIEF_LIMITS.feature} feature lines, each under ${BRIEF_LIMITS.text} characters, in plain words a newcomer understands.`,
    "- Say what the system does and how; never invent a component, a protocol or a guarantee the facts do not show. List what you could not cover in `omitted`.",
    "",
    "VOCABULARY",
    "function (what the system is for):", words("function"),
    "method (how it does it):", words("method"),
    "feature (what it guarantees):", words("feature"),
    "operation words for scopes (what one box does):", `  ${opVocab.words.map((w) => w.id).join(", ")}`,
    "",
  ];
  if (opts.restate?.length) L.push("RE-BRIEF ONLY THESE LINES, whose cited code changed — keep their meaning where the facts still support it:", ...opts.restate.map((s) => `- ${s}`), "");
  if (facts.notes.length && opts.current) {
    const lines = [...opts.current.function.map((l) => `function: ${l.text}`), ...opts.current.method.map((l) => `method: ${l.text}`), ...opts.current.feature.map((l) => `feature: ${l.text}`)];
    if (lines.length) L.push("THE BRIEF AS IT STANDS (revise it: the person's NOTES below correct it; keep what they do not touch and the facts still support):", ...lines.map((s) => `- ${s}`), "");
  }
  if (opts.guidance) L.push(`The person asks: ${opts.guidance.slice(0, 400)}`, "");
  L.push("FACTS", facts.text, "");
  const shape: string[] = ["{"];
  if (want("spec")) shape.push(`  "spec": { "function": [ { "text": "…", "words": ["…"], "cites": ["…"], "boxes": ["…"], "claims": [ { "subject": "<box id>", "verb": "watches", "object": "<zone id>" } ] } ], "method": [ … ], "feature": [ … ] },`);
  if (want("groups")) shape.push(`  "groups": [ { "op": "keep|rename|add|move", "id": "g-…", "label": "…", "kind": "${GROUP_KINDS.join("|")}", "members": ["<box id>"], "cites": ["…"] } ],`,
    `  "names": { "<box id>": { "name": "…", "cites": ["…"] } },`);
  if (want("scopes")) shape.push(`  "scopes": [ { "box": "<silent box id>", "summary": "…", "words": [ { "word": "<operation word>", "cites": ["file:line"] } ], "cites": ["…"] } ],`);
  if (want("path")) shape.push(`  "primaryPath": { "steps": ["<entry point or box id>", "…"], "cites": ["…"] },`);
  shape.push(`  "omitted": ["what you did not cover, and why (name rule ids, processes, notes as note:<n>)"]`, "}");
  L.push(
    "Answer with ONE JSON object and nothing else, in this shape" + (opts.only ? ` (only the ${opts.only} section is asked for)` : "") + ":",
    ...shape,
    "",
    want("groups") ? "Groups: `keep` a group as it is; `rename` it (new label); `move` boxes into it (members = the boxes to move); `add` a new one. Every box sits in at most one group. Propose no group without a citation." : "",
    want("scopes") ? "Scopes: only for the SILENT BOXES listed; cite the code lines shown for them, not only spec lines." : "",
    facts.notes.length ? "Notes: answer each one — a line that follows it cites note:<n>; if the facts contradict a note, say so in `omitted` (note:<n> — why)." : "",
  );
  return L.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
}
