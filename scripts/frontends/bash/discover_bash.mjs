#!/usr/bin/env node
// M-LANG2b (PLAN-M-LANG.md) — bash entry-point discovery. Speaks
// discover_entry_points.py's contract over BASH per-file IRs:
//   stdin {files: {relPath: IR}} → stdout {entryPoints: [...]}
//
// One rule in v1, and it is the honest one: a shebang script that
// defines `main` and invokes it at top level (`main "$@"` — the
// canonical bash entry pattern) is a CLI entry seeded on the main
// function. framework: "shell" (the envelope's framework field was
// opened to a free string in M-LANG1 exactly for this).
//
// M-FLOW.1 lifted the v1 limit ("shebang scripts WITHOUT the main
// pattern get no automatic entry — top-level statements aren't a function
// node a thread can seed on"): a script's BODY is its main. A shebang
// script with no `main "$@"` is a CLI entry seeded on the MODULE (the
// extractor's pseudo node for the file's top level), provided something
// executes there — a file that only defines functions is a library another
// script sources, not an entry. A real codebase's whole invoked layer
// (77 .sh backend scripts run by a platform command) was dark for this.

function discover(files) {
  const entryPoints = [];
  for (const [rel, ir] of Object.entries(files)) {
    if (ir.language !== "bash") continue;
    if (!ir.shebang) continue;
    const nodes = ir.nodes ?? [];
    const mainFn = nodes.find((n) => n.type === "function_def" && n.name === "main" && n.parentId === null);
    const topLevelInvoke = !!mainFn && nodes.some(
      (n) => n.type === "call" && n.funcName === "main" && n.parentId === null,
    );
    if (!mainFn || !topLevelInvoke) {
      // M-FLOW.1 — the module seed. Something must RUN at top level.
      const executes = nodes.some((n) => n.parentId === null && n.type !== "function_def" && n.type !== "import");
      if (!executes) continue;
      entryPoints.push({
        id: `${rel}:module`,
        kind: "cli",
        file: rel,
        irNodeId: "module",
        qualifiedName: `${ir.modulePath ?? rel}:module`,
        label: rel.split("/").pop(),
        summary: (typeof ir.docstring === "string" && ir.docstring.split("\n")[0]) || `${ir.shebang} — a script whose body is its main (no main function)`,
        framework: "shell",
        metadata: { seed: "module" },
      });
      continue;
    }
    entryPoints.push({
      id: `${rel}:main`,
      kind: "cli",
      file: rel,
      irNodeId: mainFn.id,
      qualifiedName: `${ir.modulePath ?? rel}:main`,
      label: rel.split("/").pop(),
      // PARITY — the authored doc line beats the synthetic one, exactly
      // like Python's docstring-derived summaries.
      summary: mainFn.docstring?.split("\n")[0] ?? `${ir.shebang} — main "$@" entry`,
      framework: "shell",
    });
  }
  return entryPoints;
}

let raw = "";
process.stdin.setEncoding("utf-8");
for await (const chunk of process.stdin) raw += chunk;
const { files } = JSON.parse(raw);
process.stdout.write(JSON.stringify({ entryPoints: discover(files ?? {}) }));
