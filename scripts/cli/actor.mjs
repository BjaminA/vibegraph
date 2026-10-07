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

//
// 2026-10-07 (field report) — the mark did not survive the Windows → WSL hop:
// `wsl.exe` passes only what WSLENV lists, so every command a Windows-side
// Claude ran inside WSL looked like a person's. Two changes:
//   - more than one mark: CLAUDECODE, and Claude Code's CLAUDE_CODE_ENTRYPOINT;
//   - a person's step also needs an INTERACTIVE TERMINAL. An agent's tool call
//     runs with no terminal attached, on either side of the hop, whatever its
//     environment says. VG_PERSON_NO_TTY=1 is the escape for a person's own
//     script or CI — setting it from an agent is deliberate circumvention, the
//     same as stripping CLAUDECODE. Tests run under node's test runner count
//     as that escape (NODE_TEST_CONTEXT).

export function isAgentRun(env = process.env) {
  return env.CLAUDECODE === "1" || !!env.CLAUDE_CODE_ENTRYPOINT;
}

export const PERSONS_STEP =
  "this is a person's step, and Claude Code is running this command (CLAUDECODE is set). "
  + "Run it in your own terminal, or use the Plan panel in `vibegraph-knowledge view`";

export const NO_TERMINAL =
  "this is a person's step, and no terminal is attached — an agent's tool call looks like this, from Windows or inside WSL. "
  + "Run it in your own terminal (in Git Bash on Windows, through `winpty`), use the Plan panel in `vibegraph-knowledge view`, "
  + "or, in a script of your own, set VG_PERSON_NO_TTY=1";

/** Why a person's step must be refused here, or null when it may run. */
export function personRefusal(env = process.env, io = { stdinTTY: !!process.stdin.isTTY }) {
  if (isAgentRun(env)) return PERSONS_STEP;
  if (io.stdinTTY || env.VG_PERSON_NO_TTY === "1" || env.NODE_TEST_CONTEXT) return null;
  return NO_TERMINAL;
}

/** For `doctor`: inside WSL, does a Windows-side Claude's mark reach us? */
export function wslMarkAdvice(env = process.env) {
  if (!env.WSL_DISTRO_NAME) return null;
  const carried = (env.WSLENV ?? "").split(":").some((v) => v.split("/")[0] === "CLAUDECODE");
  return carried ? null
    : "WSLENV does not carry CLAUDECODE, so a Windows-side Claude's commands here do not say they are Claude's. "
      + "Person-only steps still need your terminal; to mark the rest, run once in Windows: setx WSLENV \"CLAUDECODE/u:%WSLENV%\"";
}

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
    case "inbox": return ["agree", "reject"].includes(sub) ? `inbox ${sub}` : null;
    case "constraints": case "constraint": return ["ratify", "remove", "accept", "reject"].includes(sub) ? `constraints ${sub}` : null;
    case "skills": return ["ratify", "reaffirm", "auto-reaffirm"].includes(sub) ? `skills ${sub}` : null;
    case "architecture": return has("--ratify") || has("--reject") ? `architecture ${has("--ratify") ? "--ratify" : "--reject"}` : null;
    // Taking the hooks or skills out is how a session would stop being checked.
    case "hook": return sub === "install" && has("--remove") ? "hook install --remove" : null;
    case "init": return has("--remove-hooks") || has("--remove-skill") ? `init ${has("--remove-hooks") ? "--remove-hooks" : "--remove-skill"}` : null;
    default: return null;
  }
}
