// VibeReadme body contract (2026-08-04) — the project-scope README's shape.
//
// Deliberately NOT the repo's README.md. That file is written by humans for
// humans and says whatever its author wants. A VibeReadme is generated FROM
// the IR and answers one question in a fixed order: what is this application
// and how is it organised. Two different documents with two different
// authors; conflating them would mean regenerating something a human wrote.
//
// Structured for the same reason thread-skills are (see skill_contract.ts):
// a document with known sections can be rendered, diffed for staleness, and
// injected in part. Free-form prose can only be shown whole and trusted
// whole. The final section is the honesty block — every other section makes
// claims, and this one bounds them.
//
// Pure and deterministic: no LLM in the loop, node:test-pinned. Applied to
// the drafted prose before anything is persisted.

/** Required sections, in order — mirrors _vibeReadmePrompt exactly. */
export const VIBEREADME_REQUIRED_SECTIONS = [
  "## What this is",
  "## How it is organised",
  "## Entry points",
  "## External surface",
  "## Not statically known",
] as const;

/** A VibeReadme is a whole-project document; well past this it stops being
 *  a map and becomes a second codebase to read. */
export const VIBEREADME_MAX_CHARS = 12_000;

export interface VibeReadmeCheck {
  ok: boolean;
  /** Human-worded refusal reasons; empty iff ok. */
  problems: string[];
}

export function validateVibeReadmeBody(prose: string): VibeReadmeCheck {
  const problems: string[] = [];
  const text = (prose ?? "").trim();

  if (text.length === 0) return { ok: false, problems: ["body is empty"] };

  if (!text.startsWith(VIBEREADME_REQUIRED_SECTIONS[0])) {
    problems.push(`body must start with "${VIBEREADME_REQUIRED_SECTIONS[0]}" (no preamble)`);
  }

  // Each required section exactly once, in order. Headings matched at line
  // start so a mention inside prose does not count as the section.
  let cursor = -1;
  for (const section of VIBEREADME_REQUIRED_SECTIONS) {
    const re = new RegExp(`^${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "gm");
    const hits = text.match(re) ?? [];
    if (hits.length === 0) {
      problems.push(`missing section "${section}"`);
      continue;
    }
    if (hits.length > 1) {
      problems.push(`section "${section}" appears ${hits.length} times (expected once)`);
    }
    const at = text.search(re);
    if (at < cursor) {
      problems.push(`section "${section}" is out of order (expected ${VIBEREADME_REQUIRED_SECTIONS.join(" → ")})`);
    }
    cursor = at;
  }

  if (text.length > VIBEREADME_MAX_CHARS) {
    problems.push(`body is ${text.length} chars, over the ${VIBEREADME_MAX_CHARS} ceiling`);
  }

  return { ok: problems.length === 0, problems };
}
