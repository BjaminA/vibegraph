// WHERE A RULE WAS WRITTEN, RANKED (2026-10-22, the root-cause handoff RC5:
// "rule sourcing is lossy"). A module docstring weighed what a "Rules" section
// of CLAUDE.md weighed, so a person's own list of rules competed with every
// sentence that described code, and some were never proposed. Three tiers, the
// first always read first and never cut by the score threshold:
//
//   1  a rule section of an agent-instruction file (CLAUDE.md, AGENTS.md)
//   2  the rest of the project's prose (READMEs, design and operations docs)
//   3  a module header or a docstring

export type SourceTier = 1 | 2 | 3;

const AGENT_FILE = /(^|\/)(CLAUDE|AGENTS)\.md$/i;

export function sourceTier(c: { file: string; where: string; under?: string }, ruleHeading: RegExp): SourceTier {
  if (c.where !== "prose") return 3;
  return AGENT_FILE.test(c.file) && !!c.under && ruleHeading.test(c.under) ? 1 : 2;
}
