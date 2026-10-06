// WHO IS RUNNING THIS COMMAND (2026-09-30). The command line treats whoever
// runs it as a person — but a Claude Code session runs these commands too,
// from its own terminal, and would then agree to its own proposals, ratify
// its own spec, set the objective or take the hooks out. Claude Code marks
// every command it runs with CLAUDECODE=1; when that mark is present the
// steps that belong to a person are refused, with where to do them instead,
// and the rest are recorded as a MODEL's (a proposal, an agent-stated rule).
//
// A strong speed bump, not a lock: a session could strip the variable on
// purpose, and a command you type in Claude Code's own `!` shell carries the
// mark too — do your steps in your own terminal, or the Plan panel.

export function isAgentRun(env = process.env) {
  return env.CLAUDECODE === "1";
}

export const PERSONS_STEP =
  "this is a person's step, and Claude Code is running this command (CLAUDECODE is set). "
  + "Run it in your own terminal, or use the Plan panel in `vibegraph-knowledge view`";

/** The person-only steps, by command. `rest` = the arguments after the command. */
export function personOnlyStep(command, rest) {
  const [sub] = rest;
  const has = (flag) => rest.includes(flag);
  switch (command) {
    case "plan": return ["init", "agree", "close", "reopen", "promote"].includes(sub) ? `plan ${sub}`
      : sub === "drop" && rest[1] === "open" ? "plan drop open"
      : sub === "review" && (has("--agree") || has("--reject")) ? "plan review --agree/--reject" : null;
    case "software": return ["ratify", "remove"].includes(sub) ? `software ${sub}` : null;
    case "scope": return ["ratify", "reject"].includes(sub) ? `scope ${sub}` : null;
    case "constraints": case "constraint": return ["ratify", "remove", "accept", "reject"].includes(sub) ? `constraints ${sub}` : null;
    case "skills": return ["ratify", "reaffirm", "auto-reaffirm"].includes(sub) ? `skills ${sub}` : null;
    case "architecture": return has("--ratify") || has("--reject") ? `architecture ${has("--ratify") ? "--ratify" : "--reject"}` : null;
    // Taking the hooks or skills out is how a session would stop being checked.
    case "hook": return sub === "install" && has("--remove") ? "hook install --remove" : null;
    case "init": return has("--remove-hooks") || has("--remove-skill") ? `init ${has("--remove-hooks") ? "--remove-hooks" : "--remove-skill"}` : null;
    default: return null;
  }
}
