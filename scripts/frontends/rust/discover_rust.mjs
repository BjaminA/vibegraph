#!/usr/bin/env node
// M-RUST (PLAN-M-RUST.md §7) — Rust entry-point discovery. Contract:
//   stdin {files} → stdout {entryPoints}
//
// Two evidence-based rules, both reading what the PARSER already stamped
// (`decorators`) rather than re-parsing the source:
//
//   1. `fn main` at top level → kind "cli". framework is "tokio" or
//      "async-std" only when the attribute SAYS so (#[tokio::main]);
//      otherwise null — an async runtime is not assumed from `async`.
//   2. `#[test]` / `#[tokio::test]` → kind "test", framework
//      "cargo-test" / "tokio-test". These are found inside `mod tests`
//      too, because an inline module flattens and the attribute still
//      sits on the function.
//
// NAMED LIMIT: other harnesses (#[rstest], #[bench], #[proptest]) are not
// recognised — each is a third-party convention and would need its own
// evidence rule. Routes (axum / actix) are M-RUST.5, deliberately absent
// rather than half-detected.

const TEST_ATTRS = new Map([
  ["test", "cargo-test"],
  ["tokio::test", "tokio-test"],
  ["async_std::test", "async-std-test"],
]);

const MAIN_ATTRS = new Map([
  ["tokio::main", "tokio"],
  ["async_std::main", "async-std"],
]);

/** An attribute's bare name: `tokio::test` from `tokio::test`, and
 *  `cfg` from `cfg(test)` — arguments are not part of the identity. */
function attrName(raw) {
  return String(raw).split("(")[0].trim();
}

function firstDocLine(docstring) {
  if (!docstring) return null;
  const line = String(docstring).split("\n").find((l) => l.trim());
  return line ? line.trim() : null;
}

function discover(files) {
  const entryPoints = [];
  for (const [rel, ir] of Object.entries(files)) {
    if (ir.language !== "rust") continue;
    for (const n of ir.nodes ?? []) {
      if (n.type !== "function_def") continue;
      const attrs = (n.decorators ?? []).map(attrName);
      const signature = `${n.isAsync ? "async " : ""}fn ${n.name}(${(n.params ?? []).join(", ")})`;

      const testFramework = attrs.map((a) => TEST_ATTRS.get(a)).find(Boolean);
      if (testFramework) {
        entryPoints.push({
          id: `${rel}:${n.name}`,
          kind: "test",
          file: rel,
          irNodeId: n.id,
          qualifiedName: `${ir.modulePath ?? rel}:${n.name}`,
          label: n.name,
          // PARITY — the authored doc line first (Python's docstring rule).
          summary: firstDocLine(n.docstring) ?? signature,
          framework: testFramework,
        });
        continue;
      }

      // A `main` nested in an impl is a method called main, not an entry.
      if (n.name === "main" && n.parentId === null) {
        const runtime = attrs.map((a) => MAIN_ATTRS.get(a)).find(Boolean) ?? null;
        entryPoints.push({
          id: `${rel}:main`,
          kind: "cli",
          file: rel,
          irNodeId: n.id,
          qualifiedName: `${ir.modulePath ?? rel}:main`,
          label: rel.split("/").pop(),
          summary: firstDocLine(n.docstring) ?? signature,
          framework: runtime,
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
