// B2–B4 — THE ONE CALL (2026-10-08). The model is shown the facts pack
// (brief_facts.ts) and the vocabulary, and returns ONE JSON: the spec
// (function / method / features), group changes and names, scopes for the
// silent boxes, a start-here path, and what it left out. `only` asks for one
// section (a scopes batch, or a re-brief of stale spec lines).

import type { BriefFacts } from "./brief_facts.ts";
import { BRIEF_LIMITS, type BriefVocabulary } from "../shared/brief_types.ts";
import type { Vocabulary } from "../shared/node_io.ts";
import { GROUP_KINDS } from "./arch_store.ts";

export type BriefOnly = "spec" | "groups" | "scopes" | "path";

export function buildBriefPrompt(facts: BriefFacts, vocab: BriefVocabulary, opVocab: Vocabulary, opts: { only?: BriefOnly; guidance?: string; restate?: string[] } = {}): string {
  const want = (s: BriefOnly) => !opts.only || opts.only === s;
  const words = (part: keyof Omit<BriefVocabulary, "version">) => Object.entries(vocab[part]).map(([w, m]) => `  ${w} — ${m}`).join("\n");
  const L: string[] = [
    "You are writing the BRIEF of a codebase: a short, cited account of what it is for, how it holds together, and its key features.",
    "Below are FACTS derived from the code at zero cost (boxes, edges, rules, the declared topology, the plan, the project's docs). They are the only evidence you may cite.",
    "",
    "RULES — a claim that breaks one is refused or marked, never kept as written:",
    "- Every claim CITES ids from the facts: a box or edge id, `rule:<id>`, `plan:…`, `topology:…`, `spec:…`, or `file:line`. Cite only ids listed below. A claim with no valid citation is marked INFERRED.",
    "- Every spec line uses at least one WORD from its part of the vocabulary below, in `words`. A word not listed is refused.",
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
  if (opts.guidance) L.push(`The person asks: ${opts.guidance.slice(0, 400)}`, "");
  L.push("FACTS", facts.text, "");
  const shape: string[] = ["{"];
  if (want("spec")) shape.push(`  "spec": { "function": [ { "text": "…", "words": ["…"], "cites": ["…"], "boxes": ["…"] } ], "method": [ … ], "feature": [ … ] },`);
  if (want("groups")) shape.push(`  "groups": [ { "op": "keep|rename|add|move", "id": "g-…", "label": "…", "kind": "${GROUP_KINDS.join("|")}", "members": ["<box id>"], "cites": ["…"] } ],`,
    `  "names": { "<box id>": { "name": "…", "cites": ["…"] } },`);
  if (want("scopes")) shape.push(`  "scopes": [ { "box": "<silent box id>", "summary": "…", "words": [ { "word": "<operation word>", "cites": ["file:line"] } ], "cites": ["…"] } ],`);
  if (want("path")) shape.push(`  "primaryPath": { "steps": ["<entry point or box id>", "…"], "cites": ["…"] },`);
  shape.push(`  "omitted": ["what you did not cover, and why"]`, "}");
  L.push(
    "Answer with ONE JSON object and nothing else, in this shape" + (opts.only ? ` (only the ${opts.only} section is asked for)` : "") + ":",
    ...shape,
    "",
    want("groups") ? "Groups: `keep` a group as it is; `rename` it (new label); `move` boxes into it (members = the boxes to move); `add` a new one. Every box sits in at most one group. Propose no group without a citation." : "",
    want("scopes") ? "Scopes: only for the SILENT BOXES listed; cite the code lines shown for them, not only spec lines." : "",
  );
  return L.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
}
