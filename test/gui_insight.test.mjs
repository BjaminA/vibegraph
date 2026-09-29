// GUI insight (2026-09-28) — the pure halves of what the app now shows:
// the architecture map's Configuration lens model (arch_config.ts), the code
// view's reachability + env decorations (codeInsight.ts), and the envelope's
// freshness against an export (server/insight.ts).
//
//   npm run test:gui-insight
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envGroups, configModel } from "../src/webview/system/arch_config.ts";
import { codeInsightFor } from "../src/webview/codeInsight.ts";
import { buildInsight } from "../src/server/insight.ts";
import { sha1 } from "../src/server/coverage.ts";

test("variables group by prefix; a large prefix splits by its first two segments; a lone name stays itself", () => {
  const many = Array.from({ length: 14 }, (_, i) => `NEXT_PUBLIC_V${i}`);
  const g = envGroups(["CH_API_KEY", "CH_TIMEOUT", "OPENAI_API_KEY", ...many, "NEXT_RUNTIME"]);
  assert.deepEqual(g.get("CH_*"), ["CH_API_KEY", "CH_TIMEOUT"]);
  assert.deepEqual(g.get("OPENAI_API_KEY"), ["OPENAI_API_KEY"]);
  assert.equal(g.get("NEXT_PUBLIC_*")?.length, 14);
  assert.deepEqual(g.get("NEXT_*"), ["NEXT_RUNTIME"], "a two-part name in a split prefix stays under the prefix");
});

test("the Configuration lens model: processes, one node per group, a reads edge where a process's threads read it", () => {
  const arch = {
    nodes: [
      { id: "cluster:web:.", kind: "cluster", label: "Next.js app", sublabel: "", category: "frontend", source: "derived", threads: ["app/api/x/route.ts:POST"], refs: [] },
      { id: "cluster:scripts:.", kind: "cluster", label: "scripts", sublabel: "", category: "scripts", source: "derived", threads: ["run.sh:module"], refs: [] },
      { id: "tool:openai", kind: "tool", label: "openai", sublabel: "", category: "model", source: "derived", threads: [], refs: [] },
    ],
    edges: [{ id: "e1" }], groups: [{ id: "g" }], notes: [], unplaced: {},
  };
  const env = {
    vars: [
      { name: "OPENAI_API_KEY", declared: true, threads: ["app/api/x/route.ts:POST"], readers: [] },
      { name: "CH_API_KEY", declared: false, threads: ["run.sh:module"], readers: [] },
      { name: "CH_TIMEOUT", declared: true, threads: ["run.sh:module"], readers: [] },
    ],
    undeclared: ["CH_API_KEY"], byThread: {}, hasDeclarations: true,
  };
  const m = configModel(arch, env);
  assert.deepEqual(m.nodes.map((n) => n.id).sort(), ["cluster:scripts:.", "cluster:web:.", "env:CH_*", "env:OPENAI_API_KEY"], "tools are not drawn; processes and variable groups are");
  const ch = m.nodes.find((n) => n.id === "env:CH_*");
  assert.equal(ch.category, "config");
  assert.match(ch.sublabel, /2 variables · 1 declared nowhere/);
  assert.deepEqual(ch.members, ["CH_API_KEY  (declared nowhere)", "CH_TIMEOUT"]);
  assert.deepEqual(m.edges.map((e) => `${e.from}->${e.to}`).sort(), ["cluster:scripts:.->env:CH_*", "cluster:web:.->env:OPENAI_API_KEY"]);
  assert.equal(m.edges[0].kind, "uses", "drawn through the Tools lens pipeline");
  assert.deepEqual(m.groups, []);
  assert.deepEqual(configModel(arch, null).edges, [], "no surface: processes only");
});

test("code view: only dead-code reasons dim the whole function; used-reasons get a note; env lines get a glyph", () => {
  const astNodes = [
    { id: "module/unused.fn", line: 10, endLine: 14 },
    { id: "module/handler.fn", line: 20, endLine: 22 },
  ];
  const insight = {
    reachability: {
      defs: 3, reached: 1,
      unreached: [
        { file: "lib.py", id: "module/unused.fn", name: "unused", line: 10, reason: "never-named" },
        { file: "lib.py", id: "module/handler.fn", name: "handler", line: 20, reason: "named-not-linked" },
        { file: "other.py", id: "module/x.fn", name: "x", line: 1, reason: "never-named" },
      ],
      filesUnreached: [],
    },
    env: { vars: [{ name: "REGION", declared: false, threads: [], readers: [{ file: "lib.py", line: 21, fnId: null }] }], undeclared: ["REGION"], byThread: {}, hasDeclarations: true },
    freshness: { exported: false, changed: [] },
  };
  const d = codeInsightFor("lib.py", astNodes, insight);
  const dim = d.find((x) => x.kind === "unreached-dim");
  assert.deepEqual([dim.startLine, dim.endLine], [10, 14], "the whole function recedes");
  const note = d.find((x) => x.kind === "unreached-note");
  assert.deepEqual([note.startLine, note.endLine], [20, 20]);
  assert.match(note.text, /treat it as used/);
  const env = d.find((x) => x.kind === "env-undeclared");
  assert.equal(env.startLine, 21);
  assert.match(env.text, /REGION.*declared nowhere/);
  assert.equal(d.length, 3, "another file's rows never leak in");
  assert.deepEqual(codeInsightFor("lib.py", astNodes, null), []);
});

test("freshness: no export → not exported; an export whose hash moved → that file is changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-fresh-"));
  try {
    writeFileSync(join(dir, "a.py"), "v2\n");
    writeFileSync(join(dir, "b.py"), "same\n");
    const env = { files: { "a.py": { nodes: [] }, "b.py": { nodes: [] } }, threads: [], entryPoints: [] };
    assert.deepEqual(buildInsight(dir, env, null).freshness, { exported: false, changed: [] });
    mkdirSync(join(dir, ".vibegraph", "knowledge"), { recursive: true });
    writeFileSync(join(dir, ".vibegraph", "knowledge", "sources.json"), JSON.stringify({ "a.py": sha1("v1\n"), "b.py": sha1("same\n") }));
    assert.deepEqual(buildInsight(dir, env, null).freshness, { exported: true, changed: ["a.py"] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
