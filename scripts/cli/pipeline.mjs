// WHERE THE PARSERS ARE (2026-09-30). Parsing a project needs this package's
// own scripts (parse_cst.py, the tree-sitter frontends) and a Python that can
// import libcst — and both live in different places in a checkout and in an
// installed package (vendor/scripts, ~/.cache/vibegraph-knowledge). Every
// command that parses goes through here. Passing an empty pipeline instead
// fell back to the checkout's layout, which does not exist in an npm install:
// `plan check`, `dataflow`, `direction` and `software show --usage` crashed
// there with "parse_cst.py not found" while working in the repository.
import { locate } from "./paths.mjs";
import { resolvePython } from "./pyenv.mjs";

export function pipelineFor(loc, absRoot) {
  const py = resolvePython(loc, { log: (m) => process.stderr.write(`  ${m}\n`) });
  return { scriptsDir: loc.scriptsDir, pythonBin: py.bin, pythonEnv: py.env, cwd: absRoot, python: py };
}

/** The pipeline for this installation, for a project at `absRoot`. */
export function pipelineHere(absRoot) {
  return pipelineFor(locate(), absRoot);
}
