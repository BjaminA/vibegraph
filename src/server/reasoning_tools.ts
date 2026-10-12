// 2026-10-12 — what a REASONING spawn may not use. A Brief, a scope, Classify,
// Explain, a group proposal, a README, a skill, an Intent / compose /
// changeset / build-plan / system draft, synthesised example inputs: each
// reads what it is shown and returns text VibeGraph validates; none of them
// RUNS anything. They start `claude -p` in the project's own folder with
// permissions skipped, and Bash was still allowed — on a project that drives
// machinery a model could have started a script that moves it. File edits,
// Bash and the sub-agent tools are denied here, as the CLI's classify and
// brief already did. (The chat and the hooked run are sessions a person
// drives; an orchestrated run's reviewer may run a packet's checks.)

/** 2026-10-12 — HOW the prompt reaches `claude -p`. As an argument it is
 *  capped by the OS (Windows: 32,767 chars for the whole command line; Linux:
 *  128 KiB per argument) and a Brief's facts pack is past both — the spawn
 *  failed with ENAMETOOLONG. A long prompt goes on stdin, which `claude -p`
 *  reads when no prompt argument is given (the CLI's classify already did). */
export const PROMPT_ARG_MAX = 24 * 1024;
export const promptArgs = (prompt: string): string[] => (prompt.length > PROMPT_ARG_MAX ? [] : ["--", prompt]);
export const promptStdin = (prompt: string): string | undefined => (prompt.length > PROMPT_ARG_MAX ? prompt : undefined);

export const WRITE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
export const REASONING_DENIED_TOOLS = [...WRITE_TOOLS, "Bash", "Task", "Agent"];
