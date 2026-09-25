#!/usr/bin/env node
// M-LANG5a (PLAN-M-LANG.md) — C++ entry-point discovery. Contract:
//   stdin {files} → stdout {entryPoints}
//
// Two evidence-based rules:
//   1. `main` — a top-level function_def named exactly "main" in a
//      SOURCE file (.cpp/.cc/.cxx) → kind "cli", framework null.
//   2. gtest — TEST(Suite, Name) macros parse as function definitions
//      named "TEST" whose params carry the suite/name; each → kind
//      "test", framework "gtest", labelled Suite.Name. (TEST_F etc.
//      are a NAMED LIMIT for v1.)

const SOURCE_EXT_RE = /\.(cpp|cc|cxx)$/;

function discover(files) {
  const entryPoints = [];
  for (const [rel, ir] of Object.entries(files)) {
    if (ir.language !== "cpp") continue;
    for (const n of ir.nodes ?? []) {
      if (n.type !== "function_def" || n.parentId !== null) continue;
      if (n.name === "main" && SOURCE_EXT_RE.test(rel)) {
        entryPoints.push({
          id: `${rel}:main`,
          kind: "cli",
          file: rel,
          irNodeId: n.id,
          qualifiedName: `${ir.modulePath ?? rel}:main`,
          label: rel.split("/").pop(),
          // PARITY — authored doc line first (Python's docstring rule).
          summary: n.docstring?.split("\n")[0] ?? `int main(${(n.params ?? []).join(", ")})`,
          framework: null,
        });
      } else if (/^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(n.name)) {
        // A "." never occurs in a real C++ function name — parse_cpp
        // synthesizes `Suite.Name` ONLY for TEST/TEST_F macro
        // definitions, so the dotted shape IS the gtest discriminator.
        const [suite, name] = n.name.split(".");
        entryPoints.push({
          id: `${rel}:${n.name}`,
          kind: "test",
          file: rel,
          irNodeId: n.id,
          qualifiedName: `${ir.modulePath ?? rel}:${n.name}`,
          label: n.name,
          summary: `TEST(${suite}, ${name})`,
          framework: "gtest",
        });
      }
    }
  }
  return entryPoints;
}

let raw = "";
process.stdin.setEncoding("utf-8");
for await (const chunk of process.stdin) raw += chunk;
const { files } = JSON.parse(raw);
process.stdout.write(JSON.stringify({ entryPoints: discover(files ?? {}) }));
