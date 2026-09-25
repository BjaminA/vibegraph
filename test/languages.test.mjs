// M-LANG1 (PLAN-M-LANG.md) — the language-seam contract:
//   1. extension → language routing (registry-driven, python-only today);
//   2. python moduleIdentity parity with cross_file_link.py:file_to_module_path
//      (the server-side rule moved into src/server/languages.ts — drift here
//      would silently break cross-file linking, the exact M26 latent-bug class);
//   3. IR schema 2.0: `language` REQUIRED at 2.0, absent-but-valid on 1.x
//      (parse_cst.py keeps emitting 1.5; the server stamps the discriminator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The registry is TS; strip types on the fly the way the other .mjs suites
// exercise TS modules (node --experimental-strip-types can't import .ts from
// .mjs without the flag chain), so pin the pure logic through a tiny spawn.
const stripRun = (code) =>
  spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code],
    { cwd: ROOT, encoding: "utf-8" },
  );

test("extension routing: registered languages only", () => {
  const r = stripRun(`
    import { languageForPath, isSourceFile } from "./src/server/languages.ts";
    import { monacoLanguageForPath } from "./src/shared/languages.ts";
    const out = {
      py: languageForPath("pkg/mod.py")?.id ?? null,
      pyUpper: languageForPath("WEIRD.PY")?.id ?? null,
      sh: languageForPath("deploy.sh")?.id ?? null,
      ts: languageForPath("a/b.ts")?.id ?? null,
      js: languageForPath("web/src/api.js")?.id ?? null,
      cpp: languageForPath("src/main.cpp")?.id ?? null,
      h: languageForPath("include/geo.h")?.id ?? null,
      rs: languageForPath("src/router.rs")?.id ?? null,
      noext: languageForPath("Makefile")?.id ?? null,
      monacoPy: monacoLanguageForPath("x/y.py"),
      monacoFallback: monacoLanguageForPath(null),
      isSrcPy: isSourceFile("m.py"),
      isSrcSh: isSourceFile("m.sh"),
    };
    console.log(JSON.stringify(out));
  `);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.py, "python");
  assert.equal(out.pyUpper, "python", "extension match is case-insensitive");
  // bash registered with M-LANG2, jsts (.ts/.tsx ONLY — .js/.jsx wait
  // on the M19 text-scanned-frontend decision) with M-LANG3, cpp with
  // M-LANG5a (.h routes to cpp).
  assert.equal(out.sh, "bash");
  assert.equal(out.ts, "jsts");
  assert.equal(out.js, null, ".js is deliberately unregistered (M19 system-tier collision)");
  assert.equal(out.cpp, "cpp");
  assert.equal(out.h, "cpp");
  // M-RUST — .rs only; the frontend is read-only (rustfmt is the named
  // formatter if an edit milestone ever picks Rust up).
  assert.equal(out.rs, "rust");
  assert.equal(out.noext, null);
  assert.equal(out.monacoPy, "python");
  assert.equal(out.monacoFallback, "python", "unknown/absent paths fall back to python");
  assert.equal(out.isSrcPy, true);
  assert.equal(out.isSrcSh, true);
});

test("python moduleIdentity parity with cross_file_link.py", () => {
  const cases = [
    ["main.py", "main"],
    ["pkg/sub/mod.py", "pkg.sub.mod"],
    ["pkg/__init__.py", "pkg"],
    ["pkg/sub/__init__.py", "pkg.sub"],
  ];
  const r = stripRun(`
    import { languageForPath, moduleIdentity } from "./src/server/languages.ts";
    const py = languageForPath("x.py");
    console.log(JSON.stringify(${JSON.stringify(cases)}.map(([rel]) => moduleIdentity(py, rel))));
  `);
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout.trim());
  assert.deepEqual(got, cases.map(([, want]) => want), "registry rule matches the linker's");

  // And against the LIVE python implementation, not just the pinned table:
  // cross_file_link.py:file_to_module_path is the source of truth.
  const pyProbe = spawnSync(
    "python3",
    ["-c", [
      "import json, sys",
      "sys.path.insert(0, 'scripts')",
      "from cross_file_link import file_to_module_path",
      `print(json.dumps([file_to_module_path(p) for p in ${JSON.stringify(cases.map(([rel]) => rel))}]))`,
    ].join("\n")],
    { cwd: ROOT, encoding: "utf-8", env: { ...process.env, PYTHONPATH: join(ROOT, ".pydeps") } },
  );
  if (pyProbe.status === 0) {
    assert.deepEqual(JSON.parse(pyProbe.stdout.trim()), got, "TS registry drifted from cross_file_link.py");
  } // python3 unavailable → the pinned table above still guards the rule
});

test("IR schema 2.0: language required at 2.0, optional below", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas", "ir.schema.json"), "utf-8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const base = { nodes: [], edges: [], symbolIndex: [] };
  assert.equal(validate({ version: "2.0", language: "python", ...base }), true, "2.0 + language validates");
  assert.equal(validate({ version: "2.0", language: "bash", ...base }), true, "2.0 + bash validates");
  assert.equal(validate({ version: "2.0", ...base }), false, "2.0 WITHOUT language must fail");
  assert.equal(validate({ version: "1.5", ...base }), true, "1.5 without language still validates");
  assert.equal(
    validate({ version: "1.5", language: "python", ...base }), true,
    "server-stamped language on a 1.5 IR validates (additive, like filePath)",
  );
  assert.equal(validate({ version: "2.0", language: "cobol", ...base }), false, "unknown language rejected");
});

test("project envelope: open framework string validates", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas", "project_ir.schema.json"), "utf-8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const envelope = (framework) => ({
    version: "2.1",
    files: {},
    symbolIndex: [],
    entryPoints: [{
      id: "deploy.sh:main", kind: "cli", file: "deploy.sh",
      irNodeId: "module/main.fn", qualifiedName: "main", label: "main",
      framework,
    }],
    threads: [],
    system: { subsystems: [], edges: [] },
  });
  assert.equal(validate(envelope("flask")), true, "known python framework still validates");
  assert.equal(
    validate(envelope("shell")), true,
    "M-LANG1 opened the enum: a non-Python discover step's framework must validate",
  );
  assert.equal(validate(envelope(null)), true, "null framework still validates");
});
