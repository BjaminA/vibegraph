// PLAN-M-RUNTIME phase 3 — THE BASH RUN FLOOR.
//
// Bash could not be traced before this, and the reason was never the tracer.
// Python's floor reads the code, lists the few places it touches the world,
// and asks. That does not transfer: touching the world IS what a shell
// script is for, so a gate built that way flags every line — and `$CMD` /
// `eval` mean the list would be incomplete anyway, since bash decides what
// to run while running. A gate that fires always and can still be wrong is
// not a gate.
//
// So the floor is not "predict, then permit". It is:
//
//     MAKE THE DANGEROUS PART IMPOSSIBLE, THEN RUN IT FOR REAL.
//
// scripts/trace_bash.mjs points PATH at a directory that does not exist and
// defines `command_not_found_handle` to record and succeed. Every external
// program resolves to the recorder: `rm -rf build/` records "rm" and deletes
// nothing; `"$CMD"` expands for real — that is the prize — and then records
// instead of executing.
//
// This module is what the HUMAN is shown before that happens, and it exists
// because "nothing can run" is a claim, and a claim needs its exceptions
// stated. There is exactly one that matters:
//
//   A REDIRECTION IS NOT A COMMAND. `> /etc/hosts` truncates a file with no
//   program involved, so no PATH trick touches it. Relative redirections are
//   contained by running in a throwaway copy of the project. An ABSOLUTE one
//   is not contained by anything here, so a script containing one is
//   REFUSED rather than run with a caveat.
//
// Pure: source text in, report out. No fs, no spawn — it unit-tests on a
// string, and the server does the refusing.

/** A `>` or `>>` whose target begins with `/` — the one write the stubbed
 *  PATH cannot neutralise. Deliberately over-broad: `2>/var/log/x`,
 *  `>| /etc/x` and `&> /tmp/x` all match. Over-refusing a safe script costs
 *  a person one message; under-refusing costs them a file. */
const ABSOLUTE_REDIRECT = /(?:^|[^\w<>&])(?:\d*|&)>>?\|?\s*["']?(\/[^\s"';|&)]*)/;

/** Lines that are wholly a comment cannot redirect anything. Cheap, and it
 *  keeps a doc comment describing `> /etc/passwd` from blocking a run. */
function stripComment(line: string): string {
  const hash = line.indexOf("#");
  if (hash < 0) return line;
  // A `#` inside quotes is not a comment. Counting quotes is enough here:
  // this only ever makes the check MORE conservative, never less.
  const before = line.slice(0, hash);
  const dq = (before.match(/"/g) ?? []).length;
  const sq = (before.match(/'/g) ?? []).length;
  return dq % 2 === 0 && sq % 2 === 0 ? before : line;
}

export interface BashRedirect {
  line: number;
  target: string;
  text: string;
}

export interface BashTraceFloor {
  /** External commands the IR found — what the human is told will be
   *  intercepted. Sorted, deduped, builtins excluded by the caller's table. */
  commands: string[];
  /** Absolute-path redirections. NON-EMPTY MEANS REFUSE. */
  absoluteRedirects: BashRedirect[];
  /** True when the script may be traced. */
  ok: boolean;
  /** One line a human can act on, whichever way it went. */
  reason: string;
}

export interface BashFloorInput {
  /** The script's source, and each sourced file's, keyed by relative path. */
  sources: Record<string, string>;
  /** Command words the IR resolved to external tools (never builtins). */
  commands: string[];
}

export function assessBashTrace(input: BashFloorInput): BashTraceFloor {
  const absoluteRedirects: BashRedirect[] = [];
  for (const [file, source] of Object.entries(input.sources ?? {})) {
    source.split("\n").forEach((raw, i) => {
      const line = stripComment(raw);
      const m = ABSOLUTE_REDIRECT.exec(line);
      if (m) absoluteRedirects.push({ line: i + 1, target: m[1], text: `${file}:${i + 1}` });
    });
  }
  const commands = [...new Set(input.commands ?? [])].sort();
  if (absoluteRedirects.length) {
    const first = absoluteRedirects[0];
    return {
      commands,
      absoluteRedirects,
      ok: false,
      reason:
        `refused: ${first.text} redirects to the absolute path ${first.target}`
        + `${absoluteRedirects.length > 1 ? ` (and ${absoluteRedirects.length - 1} more)` : ""}. `
        + "A redirection is not a command, so the trace's stubbed PATH cannot intercept it — "
        + "it would write to that path for real. Relative redirections are contained by the "
        + "throwaway project copy; absolute ones are not contained by anything here.",
    };
  }
  return {
    commands,
    absoluteRedirects: [],
    ok: true,
    reason:
      commands.length
        ? `${commands.length} external command(s) will be RECORDED, not executed: ${commands.join(", ")}. `
          + "The script runs for real in a throwaway copy of your project; PATH points at nothing, "
          + "so every program resolves to a recorder that succeeds and does nothing. "
          + "`$CMD` and `eval` expand for real — that is what the trace is for — and are then recorded."
        : "No external commands found. The script runs for real in a throwaway copy of your project, "
          + "with PATH pointing at nothing so any command it resolves at runtime is recorded, not executed.",
  };
}

/** What the trace could NOT promise, stated wherever a result is rendered.
 *  A floor that only says what it prevents is half a floor. */
export const BASH_TRACE_LIMITS = [
  "Every recorded command 'succeeds' and prints nothing, so a script that branches on a "
  + "command's output or exit status takes a different path than it would for real — the trace "
  + "is true about what it ran, and may be incomplete about what a real run would reach.",
  "`command -v foo` reports foo missing, because under the trace it is.",
  "Bash builtins (cd, echo, read, printf) run natively; they are the script's own logic and "
  + "reach nothing outside the throwaway copy.",
];
