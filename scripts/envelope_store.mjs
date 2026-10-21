// The envelope cache's storage (2026-10-20). One file per parsed IR, per
// linked IR and per thread, each named by the sha1 of its own text, beside a
// small manifest (meta.json) that names them. An edit writes what it changed:
// one parse, the linked files whose links moved, the threads re-extracted. The
// cache used to write the whole envelope and parse map again after every edit
// (150 MB on a 743-file tree, 0.7 s to stringify and write), and the
// incremental path read back 56 MB of linked IR that it then rebuilt.
//
// A blob never changes once written: it goes to a temporary name and is
// renamed, so a name a manifest carries always has its whole content, and the
// manifest is written after its blobs. A blob that cannot be read fails the
// read and the caller rebuilds; it never yields a partial envelope. After a
// manifest is written, every blob it does not name is deleted.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BLOBS = "blobs";
const STALE_TMP_MS = 10 * 60 * 1000;

export const sha1 = (s) => createHash("sha1").update(s).digest("hex");

export function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Store one JSON text under its hash and return the name. `name` is the
 *  hash when the caller already computed it; `text` may be a function, called
 *  only when the blob is not stored yet. */
export function putBlob(dir, text, name = null) {
  const body = typeof text === "function" && !name ? text() : text;
  const n = name ?? sha1(body);
  const p = join(dir, BLOBS, `${n}.json`);
  if (!existsSync(p)) {
    mkdirSync(join(dir, BLOBS), { recursive: true });
    writeAtomic(p, typeof body === "function" ? body() : body);
  }
  return n;
}

/** One stored value; throws when the blob is missing or unreadable. */
export function getBlob(dir, name) {
  return JSON.parse(readFileSync(join(dir, BLOBS, `${name}.json`), "utf-8"));
}

/** Delete every blob `keep` does not name, and temporary files a crashed
 *  writer left (a live writer's are recent and stay). */
export function pruneBlobs(dir, keep) {
  let entries;
  try { entries = readdirSync(join(dir, BLOBS)); } catch { return; }
  const now = Date.now();
  for (const f of entries) {
    const p = join(dir, BLOBS, f);
    if (f.endsWith(".tmp")) {
      try { if (now - statSync(p).mtimeMs > STALE_TMP_MS) rmSync(p, { force: true }); } catch { /* gone */ }
      continue;
    }
    if (!keep.has(f.replace(/\.json$/, ""))) rmSync(p, { force: true });
  }
}
