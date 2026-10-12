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

export const WRITE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
export const REASONING_DENIED_TOOLS = [...WRITE_TOOLS, "Bash", "Task", "Agent"];
