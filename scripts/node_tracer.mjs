// VibeGraph's run recorder (2026-10-08, rung 4 of the run-time ladder). Loaded
// into a project's own Node processes with
//   NODE_OPTIONS=--import=<this file's URL>?root=<project root>
// once a person has enabled tracing (`vibegraph-knowledge trace enable`).
//
// What it records, to .vibegraph/traces/<run>.jsonl: one line per data
// operation it sees — { actor, action, zone, at } — the process (its entry
// script, relative), the verb (watch / read / write), and the ZONE the name maps
// to. Never a value, a key, a document id or the name itself: a name is matched
// against the families in .vibegraph/trace/config.json here, in the process,
// and only the zone is written ("unmatched" when none fits).
//
// How it sees them: it never imports project code (that would change the
// program's evaluation order). A synchronous module hook appends one line to
// each module the config names, as the program loads it; that line hands the
// module's classes to `__vgTracePatch`, which wraps the methods the static
// reading saw naming a resource (`Registry.meta(name)`) and the objects they
// return, so `.watch` / `.read` / `.write` on them are recorded.
//
// It does nothing — no hook, no file — unless tracing is enabled and not
// forbidden for the project, and the process's own script is inside it.
// Limit, said wherever runs are shown: an operation made through a plain
// exported function, or an SDK object no wrapped method hands out, is not seen.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";

const MAX_EVENTS = 5000;
const root = new URL(import.meta.url).searchParams.get("root");
const entry = process.argv[1] ? resolve(process.argv[1]) : null;

function settings() {
  if (!root || !entry) return null;
  const rel = relative(root, entry).split("\\").join("/");
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes("node_modules/")) return null;
  try {
    const t = JSON.parse(readFileSync(join(root, ".vibegraph", "trace.json"), "utf-8"));
    if (!t.enabled || t.forbidden) return null;
    const cfg = JSON.parse(readFileSync(join(root, ".vibegraph", "trace", "config.json"), "utf-8"));
    return { rel, cfg };
  } catch { return null; }
}

const on = settings();
if (on && typeof nodeModule.registerHooks === "function") {
  const { rel, cfg } = on;
  const run = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const dir = join(root, ".vibegraph", "traces");
  const families = (cfg.families ?? []).map((f) => ({ zone: f.zone, re: new RegExp(f.regex) }));
  const zoneOf = (name) => families.find((f) => f.re.test(name))?.zone ?? "unmatched";
  const ops = cfg.ops ?? {};
  let written = 0;
  const record = (action, zone) => {
    if (written >= MAX_EVENTS) return;
    written++;
    try {
      if (written === 1) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, `${run}.jsonl`), JSON.stringify({ actor: rel, action, zone, at: new Date().toISOString(), source: "vibegraph-tracer" }) + "\n");
    } catch { /* a recorder that cannot write records nothing; the program goes on */ }
  };
  const firstName = (args) => args.find((a) => typeof a === "string");
  // the object a naming method returns: its operations are on that zone
  const wrapObject = (o, zone) => {
    if (!o || (typeof o !== "object" && typeof o !== "function")) return o;
    return new Proxy(o, {
      get(t, k) {
        const v = Reflect.get(t, k, t);
        if (typeof v !== "function") return v;
        const op = typeof k === "string" ? ops[k] : undefined;
        return op ? (...a) => { record(op, zone); return v.apply(t, a); } : v.bind(t);
      },
    });
  };
  const wrapResult = (res, zone) => (res && typeof res.then === "function" ? res.then((o) => wrapObject(o, zone)) : wrapObject(res, zone));
  globalThis.__vgTracePatch = (file, classes) => {
    for (const t of cfg.targets ?? []) {
      if (t.file !== file) continue;
      const proto = classes[t.cls]?.prototype;
      const orig = proto?.[t.method];
      if (typeof orig !== "function" || orig.__vgTraced) continue;
      const wrapped = t.role === "name"
        ? function (...args) { const name = firstName(args); return wrapResult(orig.apply(this, args), name === undefined ? "unmatched" : zoneOf(name)); }
        : function (...args) { const name = firstName(args); record(t.op, name === undefined ? "unmatched" : zoneOf(name)); return orig.apply(this, args); };
      wrapped.__vgTraced = true;
      proto[t.method] = wrapped;
    }
  };
  const byUrl = new Map();
  for (const t of cfg.targets ?? []) {
    const url = pathToFileURL(join(root, t.file)).href;
    byUrl.set(url, [...new Set([...(byUrl.get(url) ?? []), t.cls])]);
  }
  nodeModule.registerHooks({
    load(url, context, next) {
      const r = next(url, context);
      const classes = byUrl.get(url.split("?")[0]);
      if (!classes || r.source == null) return r;
      const file = relative(root, new URL(url).pathname).split("\\").join("/");
      const hand = classes.map((c) => `${JSON.stringify(c)}: typeof ${c} === "undefined" ? undefined : ${c}`).join(", ");
      return { ...r, source: `${String(r.source)}\n;globalThis.__vgTracePatch?.(${JSON.stringify(file)}, { ${hand} });\n` };
    },
  });
}
