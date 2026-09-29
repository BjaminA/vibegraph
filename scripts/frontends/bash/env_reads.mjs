// 2026-09-28 — the environment a bash script INHERITS: an UPPERCASE variable
// it expands (`$X`, `${X:-default}`) and never assigns (`X=`, `export X=`,
// `local X`, `for X in`, `read X`). Rides the IR root as `envReads`, form
// "inherited" — the same shape the Python and JS/TS frontends emit.
//
// Honest limits, said where the data is used: a variable a SOURCED file sets
// reads as inherited here (the file alone cannot tell), and the knowledge
// layer subtracts names any project script assigns; lowercase names are left
// out by convention; bash's own variables and the ambient OS ones are not
// configuration and are never listed.

const SHELL_OWN = new Set([
  "BASH", "BASH_SOURCE", "BASH_LINENO", "BASH_REMATCH", "BASH_VERSION", "BASHPID", "FUNCNAME",
  "IFS", "LINENO", "RANDOM", "SECONDS", "PPID", "UID", "EUID", "GROUPS", "HOSTNAME", "HOSTTYPE",
  "OPTARG", "OPTIND", "OPTERR", "REPLY", "PIPESTATUS", "SHLVL", "OSTYPE", "MACHTYPE", "EPOCHSECONDS",
  "EPOCHREALTIME", "COLUMNS", "LINES", "PS1", "PS2", "PS4", "HISTFILE",
  // ambient: the OS sets these for every process; they configure nothing of the project's
  "HOME", "PATH", "PWD", "OLDPWD", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR", "TZ",
]);
const UPPER = /^[A-Z][A-Z0-9_]*$/;

export function collectEnvReads(root) {
  const assigned = new Set();
  const refs = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    switch (n.type) {
      case "variable_assignment": {
        const name = n.childForFieldName("name");
        if (name) assigned.add(name.type === "subscript" ? name.childForFieldName("name")?.text : name.text);
        break;
      }
      case "for_statement": {
        const v = n.childForFieldName("variable");
        if (v) assigned.add(v.text);
        break;
      }
      case "declaration_command":
        // `export X` / `local X` / `declare -a X` with no value
        for (const c of n.namedChildren) if (c.type === "variable_name") assigned.add(c.text);
        break;
      case "command": {
        const cmd = n.childForFieldName("name")?.text;
        if (cmd === "read" || cmd === "mapfile" || cmd === "readarray") {
          for (const a of n.childrenForFieldName("argument")) if (a.type === "word" && !a.text.startsWith("-")) assigned.add(a.text);
        }
        break;
      }
      case "simple_expansion":
      case "expansion": {
        const v = n.namedChildren.find((c) => c.type === "variable_name")
          ?? n.namedChildren.find((c) => c.type === "subscript")?.childForFieldName("name");
        if (v) refs.push({ name: v.text, line: v.startPosition.row + 1 });
        break;
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i));
  }
  const seen = new Set();
  const out = [];
  for (const r of refs.sort((a, b) => a.line - b.line)) {
    if (!UPPER.test(r.name) || SHELL_OWN.has(r.name) || assigned.has(r.name) || seen.has(r.name)) continue;
    seen.add(r.name);
    out.push({ name: r.name, line: r.line, form: "inherited" });
  }
  return out;
}
