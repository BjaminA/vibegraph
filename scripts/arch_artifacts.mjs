// M-ARCH.5 (PLAN-M-ARCH.md) — the architecture's files, written by both
// `export --architecture` and the `architecture` command:
//
//   architecture.md             the system map as an agent reads it (src/server/system_map_md.ts)
//   architecture.vibegraph.json the system map as data, format vibegraph.system-map: every
//                               record, every lens (Bird's-eye, Overview, Tools, Flows,
//                               Payloads, Trust), the hierarchy, the start-here story, the
//                               subsystems and the thread graph (src/server/system_map.ts,
//                               schemas/system_map.schema.json)
//   architecture.html           the map for people, self-contained (src/server/arch_html.ts)
//   architecture.json           the raw ArchModel (derived + stated + any pending proposal)
//   architecture.archify.json   ONLY with `archify: true` (--archify): the same model in
//                               Archify's schema, for that tool. Ours is the system map
//                               (2026-09-25, Ben: "shouldn't be called archify").
//
// And the one git question the Archify file needs answered: a source may be
// cited only against a PINNED commit of a checkout whose origin is known, so
// `repositoryFor` answers only when the analysed files are committed and
// clean — a dirty tree would cite lines the commit does not contain.
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { renderArchHtml } from "../src/server/arch_html.ts";
import { toArchify } from "../src/server/arch_archify.ts";
import { buildSystemMap } from "../src/server/system_map.ts";
import { renderSystemMapMd } from "../src/server/system_map_md.ts";

const json = (v) => JSON.stringify(v, null, 2) + "\n";

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Origin as a credential-free URL Archify can link: a github / gitee SSH or
 *  HTTPS remote becomes its canonical https form (web links); anything else
 *  is kept as written and marked local-only. */
export function canonicalRemote(url) {
  const m = /^(?:git@|ssh:\/\/git@|https:\/\/)(github\.com|gitee\.com)[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url ?? "");
  if (m) return { url: `https://${m[1]}/${m[2]}/${m[3]}`, web: true };
  if (!url || /@.*:.*@|\?|#/.test(url)) return null;
  return { url: url.replace(/^[^@/]+@(?=[^:]+:)/, (s) => s), web: false };
}

/** { url, revision, prefix, web } | null — see the header. */
export function repositoryFor(absRoot) {
  const top = git(absRoot, ["rev-parse", "--show-toplevel"]);
  const revision = git(absRoot, ["rev-parse", "HEAD"]);
  const origin = git(absRoot, ["remote", "get-url", "origin"]);
  if (!top || !revision || !/^[0-9a-f]{40}$/.test(revision) || !origin) return null;
  const dirty = git(absRoot, ["status", "--porcelain", "--", "."]);
  if (dirty === null || dirty.length > 0) return null;
  const remote = canonicalRemote(origin);
  if (!remote) return null;
  const prefix = relative(resolve(top), resolve(absRoot)).split("\\").join("/");
  return { url: remote.url, revision, prefix, web: remote.web };
}

/** The system map for a model, with the envelope's entry points, subsystem
 *  tier and thread graph when the caller has them. */
export function systemMapFor(model, { title, commit, tool, envelope = null, threadGraph = null }) {
  return buildSystemMap(model, {
    title, commit, tool,
    entryPoints: envelope?.entryPoints ?? [],
    system: envelope?.system ?? null,
    threadGraph,
  });
}

/** Write the files through `write(rel, text)`; returns what it wrote. */
export function writeArchArtifacts(model, { write, title, commit, tool, repository = null, skipJson = false, archify = false, envelope = null, threadGraph = null }) {
  const written = [];
  const map = systemMapFor(model, { title, commit, tool, envelope, threadGraph });
  write("architecture.md", renderSystemMapMd(map));
  written.push("architecture.md");
  write("architecture.vibegraph.json", json(map));
  written.push("architecture.vibegraph.json");
  write("architecture.html", renderArchHtml(model, { title, commit, tool }));
  written.push("architecture.html");
  if (!skipJson) { write("architecture.json", json(model)); written.push("architecture.json"); }
  if (archify) {
    write("architecture.archify.json", json(toArchify(model, { title, commit, tool, repository })));
    written.push("architecture.archify.json");
  }
  return written;
}
