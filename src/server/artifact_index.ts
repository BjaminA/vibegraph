// M-TRAINED.1 (PLAN-M-TRAINED.md) — the artifact index: trained-ness as
// ARTIFACT STATE, deterministically.
//
// An artifact is a file the project's OWN CODE produces (model.pt, *.pkl…),
// as opposed to data the world provides (*.csv — M-RUN2's domain). The split
// is load-bearing: for missing data the honest offer is a drafted example;
// for a missing artifact the honest offer is "run the producer thread".
//
// Detection is lexical over the per-file IR (never an LLM, never a guess):
// a call node whose args/preview quote an artifact-extension literal, whose
// call name is save/dump/write-shaped (producer) or load/read/open-shaped
// (consumer). Anything ambiguous is IGNORED — a miss falls back to today's
// behavior, never a wrong offer. Thread attribution follows the structural
// node-id grammar: the site's enclosing .fn prefix matched against thread
// nodes' (file, irNodeId); a module-level site attributes to threads seeded
// in its file.
//
// Staleness mirrors M-SKILL.7's stamp-vs-current pattern with mtimes: an
// artifact older than the newest source file of any producer thread is
// STALE ("code changed since training") — stated, never blocking.
//
// Pure: all fs access is injected. The server wires the live envelope.

export interface ArtifactSite {
  entryPointId: string;
  qualifiedName: string;
  file: string;
  line: number;
  nodeId: string;
  /** The call as written, e.g. "torch.save" — provenance for the card. */
  call: string;
}

export interface ArtifactRecord {
  /** Project-relative artifact path. */
  path: string;
  producers: ArtifactSite[];
  consumers: ArtifactSite[];
  exists: boolean;
  mtimeMs: number | null;
  /** exists AND older than the newest source file of a producer thread. */
  stale: boolean;
  staleReason: string | null;
}

export interface FileStat {
  exists: boolean;
  mtimeMs: number | null;
}

interface IrNodeShape {
  id?: unknown;
  type?: unknown;
  line?: unknown;
  funcName?: unknown;
  callTarget?: unknown;
  args?: unknown;
  preview?: unknown;
  params?: unknown;
}

interface ThreadShape {
  entryPointId?: string | null;
  seed?: { file?: string; qualifiedName?: string };
  filesReached?: string[];
  nodes?: unknown[];
}

export interface ArtifactIndexInputs {
  /** Envelope threads (structural read — absent fields add nothing). */
  threads: ThreadShape[];
  /** Relative path → per-file IR ({ nodes }). */
  files: Record<string, { nodes?: unknown[] }>;
  /** Stat a project-relative path (source files AND artifacts). */
  statFile: (rel: string) => FileStat;
}

// Artifact extensions — produced-by-code. Deliberately DISJOINT from
// missing_data.ts's DATA_PATH_RE (npy/npz stay data): a path matching both
// worlds would get two contradictory offers.
const ARTIFACT_PATH_RE =
  /['"]([\w./-]+\.(?:pt|pth|ckpt|safetensors|pkl|pickle|joblib|onnx|h5))['"]/g;

const WRITE_CALL_RE = /(^|\.)(save|dump|write)\w*$/;
const READ_CALL_RE = /(^|\.)(load|read|open)\w*$/;

/** The enclosing function's structural id ("module/Shape.class/area.fn"),
 *  or null for a module-level site. */
export function enclosingFnId(nodeId: string): string | null {
  const segs = nodeId.split("/");
  const acc: string[] = [];
  for (const seg of segs.slice(0, -1)) {
    acc.push(seg);
    if (seg.endsWith(".fn")) return acc.join("/");
  }
  return null;
}

function siteKind(call: string): "write" | "read" | null {
  if (WRITE_CALL_RE.test(call)) return "write";
  if (READ_CALL_RE.test(call)) return "read";
  return null;
}

interface RawSite {
  path: string;
  kind: "write" | "read";
  file: string;
  line: number;
  nodeId: string;
  call: string;
}

// Sitting-2 — a plain identifier passed to a save/load call, e.g.
// `torch.save(model.state_dict(), weights_path)`.
const PLAIN_NAME_RE = /^[A-Za-z_]\w*$/;

/** Sitting-3 — project-wide map of module-level constant name → artifact
 *  literal (`MODEL_PATH = "model.pt"`). One hop past the param-default
 *  resolution, still lexical: the assignment's preview must BE the quoted
 *  literal (never an expression around it), and a name bound to two
 *  different literals anywhere in the project is ambiguous and dropped. */
function collectModuleConstants(files: ArtifactIndexInputs["files"]): Map<string, string> {
  const byName = new Map<string, string>();
  const dropped = new Set<string>();
  for (const ir of Object.values(files)) {
    for (const raw of ir.nodes ?? []) {
      const n = raw as IrNodeShape;
      if (n.type !== "assignment" || typeof n.id !== "string" || typeof n.preview !== "string") continue;
      const m = /^module\/([A-Za-z_]\w*)\.assign$/.exec(n.id);
      if (!m) continue;
      const preview = n.preview.trim();
      const lit = [...preview.matchAll(ARTIFACT_PATH_RE)];
      if (lit.length !== 1 || preview !== `"${lit[0][1]}"` && preview !== `'${lit[0][1]}'`) continue;
      const name = m[1];
      if (dropped.has(name)) continue;
      if (byName.has(name) && byName.get(name) !== lit[0][1]) {
        byName.delete(name);
        dropped.add(name);
        continue;
      }
      byName.set(name, lit[0][1]);
    }
  }
  return byName;
}

/** Per-function map of param name → artifact-literal DEFAULT
 *  ("weights_path" → "model.pt" from `def main(weights_path="model.pt")`),
 *  including a default that names a module constant
 *  (`def main(model_path=MODEL_PATH)` with `MODEL_PATH = "model.pt"`). */
function collectParamDefaults(
  nodes: unknown[],
  constants: Map<string, string>,
): Map<string, Map<string, string>> {
  const byFn = new Map<string, Map<string, string>>();
  for (const raw of nodes) {
    const n = raw as IrNodeShape;
    if (n.type !== "function_def" || typeof n.id !== "string" || !Array.isArray(n.params)) continue;
    const defaults = new Map<string, string>();
    for (const p of n.params) {
      if (typeof p !== "string") continue;
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      const rhs = p.slice(eq + 1).trim();
      const lit = [...rhs.matchAll(ARTIFACT_PATH_RE)];
      if (lit.length === 1) defaults.set(p.slice(0, eq).trim(), lit[0][1]);
      else if (PLAIN_NAME_RE.test(rhs) && constants.has(rhs)) {
        defaults.set(p.slice(0, eq).trim(), constants.get(rhs)!);
      }
    }
    if (defaults.size) byFn.set(n.id, defaults);
  }
  return byFn;
}

function collectSites(files: ArtifactIndexInputs["files"]): RawSite[] {
  const sites: RawSite[] = [];
  const constants = collectModuleConstants(files);
  for (const [file, ir] of Object.entries(files)) {
    const paramDefaults = collectParamDefaults(ir.nodes ?? [], constants);
    for (const raw of ir.nodes ?? []) {
      const n = raw as IrNodeShape;
      const call = typeof n.funcName === "string" ? n.funcName
        : typeof n.callTarget === "string" ? n.callTarget : null;
      if (!call || typeof n.id !== "string") continue;
      const kind = siteKind(call);
      if (!kind) continue;
      const texts = [
        ...(Array.isArray(n.args) ? n.args.filter((a): a is string => typeof a === "string") : []),
        ...(typeof n.preview === "string" ? [n.preview] : []),
      ];
      const seen = new Set<string>();
      const found = (path: string) => {
        if (seen.has(path)) return;
        seen.add(path);
        sites.push({
          path, kind, file,
          line: typeof n.line === "number" ? n.line : 0,
          nodeId: n.id, call,
        });
      };
      for (const t of texts) {
        for (const m of t.matchAll(ARTIFACT_PATH_RE)) found(m[1]);
      }
      // Sitting-2 — the sitting's real shape: the artifact path lives in the
      // enclosing function's DEFAULT (`def main(..., weights_path="model.pt")`)
      // and the call passes the param name. Resolving a plain-name arg against
      // that default is still lexical + deterministic (the as-written default,
      // never a traced value); anything else stays ignored.
      const defaults = paramDefaults.get(enclosingFnId(n.id) ?? "");
      if (Array.isArray(n.args)) {
        for (const a of n.args) {
          if (typeof a !== "string" || !PLAIN_NAME_RE.test(a.trim())) continue;
          // Param default first (nearest binding), then a module constant —
          // e.g. `torch.save(model.state_dict(), MODEL_PATH)`.
          const resolved = defaults?.get(a.trim()) ?? constants.get(a.trim());
          if (resolved) found(resolved);
        }
      }
    }
  }
  return sites;
}

/** Threads whose walk includes (file, fnId) — or, for a module-level site
 *  (fnId null), threads seeded in the file. */
function threadsForSite(
  threads: ThreadShape[],
  file: string,
  fnId: string | null,
): Array<{ entryPointId: string; qualifiedName: string }> {
  const out: Array<{ entryPointId: string; qualifiedName: string }> = [];
  for (const t of threads) {
    if (!t.entryPointId) continue;
    const hit = fnId === null
      ? t.seed?.file === file
      : (t.nodes ?? []).some((raw) => {
          const n = raw as { file?: unknown; irNodeId?: unknown };
          return n.file === file && n.irNodeId === fnId;
        });
    if (hit) out.push({ entryPointId: t.entryPointId, qualifiedName: t.seed?.qualifiedName ?? t.entryPointId });
  }
  return out;
}

export function buildArtifactIndex(inputs: ArtifactIndexInputs): ArtifactRecord[] {
  const byPath = new Map<string, { producers: ArtifactSite[]; consumers: ArtifactSite[] }>();

  for (const site of collectSites(inputs.files)) {
    const fnId = enclosingFnId(site.nodeId);
    const threads = threadsForSite(inputs.threads, site.file, fnId);
    const entry = byPath.get(site.path) ?? { producers: [], consumers: [] };
    const bucket = site.kind === "write" ? entry.producers : entry.consumers;
    if (threads.length === 0) {
      // Site exists but no thread walks it — still record with an empty
      // attribution so the artifact is never silently invisible.
      bucket.push({ entryPointId: "", qualifiedName: "", file: site.file, line: site.line, nodeId: site.nodeId, call: site.call });
    }
    for (const t of threads) {
      if (!bucket.some((s) => s.entryPointId === t.entryPointId && s.nodeId === site.nodeId)) {
        bucket.push({ ...t, file: site.file, line: site.line, nodeId: site.nodeId, call: site.call });
      }
    }
    byPath.set(site.path, entry);
  }

  const records: ArtifactRecord[] = [];
  for (const [path, { producers, consumers }] of [...byPath.entries()].sort()) {
    const stat = inputs.statFile(path);
    let stale = false;
    let staleReason: string | null = null;
    if (stat.exists && stat.mtimeMs !== null && producers.length > 0) {
      // Newest source mtime across every producer thread's reached files
      // (plus the producing file itself, for module-level producers).
      const sourceFiles = new Set<string>(producers.map((p) => p.file));
      const threadsById = new Map(
        inputs.threads.filter((t) => t.entryPointId).map((t) => [t.entryPointId as string, t]),
      );
      for (const p of producers) {
        const t = p.entryPointId ? threadsById.get(p.entryPointId) : undefined;
        for (const f of t?.filesReached ?? []) sourceFiles.add(f);
        if (t?.seed?.file) sourceFiles.add(t.seed.file);
      }
      let newest: { file: string; mtimeMs: number } | null = null;
      for (const f of sourceFiles) {
        const s = inputs.statFile(f);
        if (s.exists && s.mtimeMs !== null && (!newest || s.mtimeMs > newest.mtimeMs)) {
          newest = { file: f, mtimeMs: s.mtimeMs };
        }
      }
      if (newest && newest.mtimeMs > stat.mtimeMs) {
        stale = true;
        staleReason = `${newest.file} changed after this artifact was produced`;
      }
    }
    records.push({
      path,
      producers,
      consumers,
      exists: stat.exists,
      mtimeMs: stat.mtimeMs,
      stale,
      staleReason,
    });
  }
  return records;
}

/** Distinct consuming THREAD names for an artifact's "consumed by" line.
 *  `consumers` is per-SITE: one thread can consume an artifact at two sites
 *  (e.g. the `load_model(path)` call in a function AND the `torch.load(path)`
 *  inside load_model that the same thread walks into), which listed the
 *  thread twice. Dedupe by entryPointId, first name wins; sites with no
 *  walking thread (empty entryPointId) are dropped from the human list. */
export function consumerThreadNames(consumers: ArtifactSite[]): string[] {
  return [
    ...new Map(
      consumers.filter((c) => c.entryPointId).map((c) => [c.entryPointId, c.qualifiedName]),
    ).values(),
  ];
}

/** Is this path artifact-shaped at all (used by the run path to decide
 *  "never draft binary content" even when no producer is known)? */
export function isArtifactPath(path: string): boolean {
  return /\.(?:pt|pth|ckpt|safetensors|pkl|pickle|joblib|onnx|h5)$/.test(path);
}

// ── M-TRAINED.3 — missing-artifact detection on the run path ──────────
// The M-RUN2 missing-data tiers deliberately exclude artifact extensions
// (drafting binary content is nonsense). This is their artifact sibling:
// scan the refused run's offense lines for artifact literals that are
// missing on disk, and answer with the PRODUCER (from the index) instead
// of a drafting offer. Detection only — nothing runs, nothing drafts.

export interface MissingArtifact {
  path: string;
  producers: Array<{ entryPointId: string; qualifiedName: string; nodeId: string; file: string }>;
}

export interface OffenseSiteShape {
  file?: string | null;
  line?: number | null;
}

function producersFor(index: ArtifactRecord[], path: string): MissingArtifact["producers"] {
  const rec = index.find((r) => r.path === path);
  return (rec?.producers ?? [])
    .filter((p) => p.entryPointId)
    .map((p) => ({ entryPointId: p.entryPointId, qualifiedName: p.qualifiedName, nodeId: p.nodeId, file: p.file }));
}

const ARTIFACT_LINE_RE =
  /['"]([\w./-]+\.(?:pt|pth|ckpt|safetensors|pkl|pickle|joblib|onnx|h5))['"]/g;

/** Pre-run tier: offense source lines naming a missing artifact literal.
 *  Runs over ALL offenses (unresolved calls included — torch.load carries
 *  no parse-time effectKind). */
export function detectMissingArtifacts(
  offenses: OffenseSiteShape[],
  index: ArtifactRecord[],
  readLine: (file: string, line: number) => string | null,
  statFile: (rel: string) => FileStat,
): MissingArtifact[] {
  const out: MissingArtifact[] = [];
  const seen = new Set<string>();
  for (const o of offenses) {
    if (!o.file || !o.line) continue;
    const src = readLine(o.file, o.line);
    if (!src) continue;
    for (const m of src.matchAll(ARTIFACT_LINE_RE)) {
      if (seen.has(m[1]) || statFile(m[1]).exists) continue;
      seen.add(m[1]);
      out.push({ path: m[1], producers: producersFor(index, m[1]) });
    }
  }
  return out;
}

/** Post-run tier: a FileNotFoundError path that is artifact-shaped. */
export function missingArtifactFor(index: ArtifactRecord[], path: string): MissingArtifact {
  return { path, producers: producersFor(index, path) };
}
