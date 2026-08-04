// M-RUN2.2 — a throwaway full copy of the analyzed project for SYNTHETIC
// runs. Consent to run made-up inputs means "run it", never "run it on my
// real files": any run whose premise includes a synthesized artifact beyond
// literal args (an example instance today; example data files next) executes
// against this copy, so even a consented effectful path cannot touch the
// real tree. Plain SM1/SM2 runs keep the fast in-place path — their
// clean-tree property is separately proven (run_to_node.test.mjs).
//
// Same copy recipe as the changeset check sandbox (changesetProposeCore,
// server.ts) — kept as its own small module here rather than refactoring
// that proven path; if a THIRD sandbox consumer appears, consolidate.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface RunSandbox {
  root: string;
  dispose(): void;
}

export function makeRunSandbox(projectRoot: string): RunSandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vg-run-sandbox-"));
  fs.cpSync(projectRoot, root, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}.git`),
  });
  return {
    root,
    dispose: () => {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}
