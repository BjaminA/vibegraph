// WHICH VERSION WROTE .vibegraph/ (2026-10-07, field report). Inside a
// project, `npx vibegraph-knowledge view` ran an older LOCAL copy (0.27.1)
// against a plan.json a newer global one (0.27.4) had written, and agreeing
// items in the Plan panel silently did nothing. Every store write now stamps
// `.vibegraph/writer.json` with the version that wrote it, and a start-up
// that finds a NEWER stamp says so.
//
// The running version comes from VG_VERSION (the CLI sets it from its own
// package.json; `view` passes it to the server). A dev run with no version
// stamps nothing and warns about nothing.

import * as fs from "fs";
import * as path from "path";

export const WRITER_FILE = path.join(".vibegraph", "writer.json");

const parse = (v: string) => v.split("-")[0].split(".").map((x) => Number(x) || 0);

/** a > b, by major.minor.patch */
export function newerVersion(a: string, b: string): boolean {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** Called beside a store's write. Never throws: a stamp is a courtesy. */
export function stampWriter(root: string, store: string, version: string | undefined = process.env.VG_VERSION): void {
  if (!version) return;
  try {
    const p = path.join(root, WRITER_FILE);
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(fs.readFileSync(p, "utf-8")); } catch { cur = {}; }
    const prev = typeof cur.version === "string" ? cur.version : null;
    // the stamp records the NEWEST version that has written here — and only
    // that, so a committed .vibegraph/ changes when the version does, not on
    // every save
    if (prev && !newerVersion(version, prev)) return;
    void store;
    fs.writeFileSync(p, JSON.stringify({ version }, null, 2) + "\n");
  } catch { /* read-only tree */ }
}

/** A warning when a newer version has written this project's .vibegraph/. */
export function writerWarning(root: string, version: string | undefined = process.env.VG_VERSION): string | null {
  if (!version) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, WRITER_FILE), "utf-8"));
    if (typeof j.version === "string" && newerVersion(j.version, version)) {
      return `this project's .vibegraph/ was written by vibegraph-knowledge ${j.version}; this is ${version}. An older version may misread what a newer one wrote — `
        + "run the newer one (`npx vibegraph-knowledge@latest`, or the global install), or update this one.";
    }
  } catch { /* no stamp */ }
  return null;
}
