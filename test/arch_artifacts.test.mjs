// M-ARCH.5 (PLAN-M-ARCH.md) — the architecture artifacts: a self-contained
// `architecture.html`, `architecture.archify.json` in Archify's own schema,
// and the `architecture` CLI command (with M-ARCH.4's --propose / --modify /
// --ratify / --reject, driven by the stub model).
//
//   npm run test:arch-artifacts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { applyArchStore, emptyStore } from "../src/server/arch_store.ts";
import { toArchify } from "../src/server/arch_archify.ts";
import { renderArchHtml, archHtmlData } from "../src/server/arch_html.ts";
import { canonicalRemote } from "../scripts/arch_artifacts.mjs";
import { buildProposePrompt } from "../src/server/arch_propose.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STUB = join(ROOT, "test/fixtures/arch/fake_claude_arch.mjs");
const derivedOf = (rel) => {
  const root = join(ROOT, rel);
  const env = buildPolyglotEnvelope(root).envelope;
  return archModelForEnvelope(env, buildStackIndex(env, root), buildCrossingIndex(env), root, undefined, { applyStore: false });
};
const GROUPS = [
  { id: "g-public", kind: "network", label: "public network", wraps: ["cluster:web:.", "cluster:mcp:."] },
  { id: "g-volt", kind: "host", label: "Volt host", wraps: ["cluster:scripts:."] },
];
let next, fleet, shop, validate;

before(() => {
  next = applyArchStore(derivedOf("test/fixtures/webstack/next_demo"), {
    ...emptyStore(), groups: GROUPS,
    proposal: { at: "x", model: "stub", groups: [{ id: "g-prop", kind: "trust", label: "proposed zone", wraps: ["tool:pg"], evidence: [] }], names: {}, refused: [] },
  });
  fleet = derivedOf("examples/fleet-telemetry");
  shop = derivedOf("test/fixtures/polyglot/shop_demo");
  const dir = join(ROOT, "test/fixtures/arch/archify");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(JSON.parse(readFileSync(join(dir, "common.schema.json"), "utf-8")));
  validate = ajv.compile(JSON.parse(readFileSync(join(dir, "architecture.schema.json"), "utf-8")));
});

test("the Archify file validates against Archify's own schema, for every fixture", () => {
  for (const [name, m] of [["next", next], ["fleet", fleet], ["shop", shop]]) {
    const a = toArchify(m, { title: name, commit: "abc1234" });
    assert.ok(validate(a), `${name}: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
  }
});

test("Archify has no provenance field, so only stated groups become boundaries, and the file says what it left out", () => {
  const a = toArchify(next, { title: "next", commit: "abc1234" });
  assert.deepEqual(a.boundaries.map((b) => b.label), ["public network (network)", "Volt host (host)"]);
  assert.deepEqual(a.boundaries.map((b) => b.kind), ["security-group", "region"]);
  const prov = a.cards.find((c) => c.title === "Provenance").items.join("\n");
  assert.match(prov, /1 proposed group\(s\) awaiting ratification are not exported/);
  assert.match(prov, /No sources are cited/);
  assert.match(prov, /platform → cloud/);
  // Every one of our ids is recoverable from its slug.
  const ids = a.cards.find((c) => c.title === "VibeGraph ids").items;
  for (const n of next.nodes) assert.ok(ids.some((line) => line.endsWith(` = ${n.id}`)), n.id);
});

test("every Archify route runs through empty lanes: no segment crosses an unrelated box (Archify's clean-flow gate)", () => {
  for (const [name, m] of [["next", next], ["fleet", fleet], ["shop", shop]]) {
    const a = toArchify(m, { title: name });
    const g = a.layout;
    const box = new Map(a.components.map((c) => [c.id, {
      x: g.origin[0] + c.col * (g.cellW + g.gapX), y: g.origin[1] + c.row * (g.cellH + g.gapY), w: c.size[0], h: c.size[1],
    }]));
    const anchor = (b, side) => side === "left" ? [b.x, b.y + b.h / 2] : [b.x + b.w, b.y + b.h / 2];
    const crosses = ([x1, y1], [x2, y2], b) => {
      const pad = 2;
      if (x1 === x2) return x1 > b.x - pad && x1 < b.x + b.w + pad && Math.max(y1, y2) > b.y - pad && Math.min(y1, y2) < b.y + b.h + pad;
      return y1 > b.y - pad && y1 < b.y + b.h + pad && Math.max(x1, x2) > b.x - pad && Math.min(x1, x2) < b.x + b.w + pad;
    };
    for (const c of a.connections) {
      const pts = [anchor(box.get(c.from), c.fromSide), ...c.via, anchor(box.get(c.to), c.toSide)];
      for (let i = 0; i < pts.length - 1; i++) {
        assert.ok(pts[i][0] === pts[i + 1][0] || pts[i][1] === pts[i + 1][1], `${name} ${c.from}->${c.to}: segment ${i} is not axis-aligned`);
        for (const [id, b] of box) {
          if (id === c.from || id === c.to) continue;
          assert.ok(!crosses(pts[i], pts[i + 1], b), `${name} ${c.from}->${c.to}: segment ${i} crosses ${id}`);
        }
      }
    }
  }
});

test("sources are cited only against a pinned commit, repo-root relative", () => {
  const a = toArchify(next, { title: "next", repository: { url: "https://github.com/o/r", revision: "a".repeat(40), prefix: "test/fixtures/webstack/next_demo", web: true } });
  assert.ok(validate(a), JSON.stringify(validate.errors?.slice(0, 3)));
  assert.equal(a.meta.repository.link_mode, "web");
  const web = a.components.find((c) => c.label === "Next.js app");
  assert.ok(web.sources.every((s) => s.path.startsWith("test/fixtures/webstack/next_demo/")));
  assert.deepEqual(canonicalRemote("git@github.com:BjaminA/vibegraph.git"), { url: "https://github.com/BjaminA/vibegraph", web: true });
  assert.equal(canonicalRemote("https://gitlab.example.com/a/b.git").web, false);
  assert.equal(canonicalRemote("https://user:secret@host/a?b"), null, "a credential or query is never cited");
});

test("the HTML is self-contained, laid out per lens by the map's own function, and byte-stable", () => {
  const html = renderArchHtml(next, { title: "next_demo", commit: "abc1234" });
  assert.equal(html, renderArchHtml(next, { title: "next_demo", commit: "abc1234" }), "two renders of one model are identical");
  assert.ok(!/\b(src|href)=["']?https?:/i.test(html), "no network fetch of any kind");
  assert.ok(!/<link\b/i.test(html));
  const data = JSON.parse(html.match(/<script type="application\/json" id="vg-data">([\s\S]*?)<\/script>/)[1]);
  // Bird's-eye (2026-09-24) rides the file too: the same lens list as the map.
  assert.deepEqual(Object.keys(data.lenses), ["birdseye", "overview", "tools", "flows", "payloads", "trust"]);
  assert.deepEqual(data, JSON.parse(JSON.stringify(archHtmlData(next))));
  // Groups are geometry too; the Trust lens keeps only edges that cross a boundary.
  assert.ok(data.lenses.overview.nodes.some((n) => n.g === "g-public"));
  const trust = data.lenses.trust.edges.map((e) => e.id);
  assert.ok(trust.includes("cluster:web:.->cluster:scripts:.:command:Volt · WebSocket · command"));
  assert.ok(!trust.includes("cluster:web:.->cluster:mcp:.:tool:MCP"), "web → mcp stays inside the public network");
  // A payload label rides the payloads lens.
  // (`full`; the drawn `label` may be cut to the spot the router found.)
  assert.ok(data.lenses.payloads.edges.some((e) => e.full === "{ name, arguments, arguments.region }"
    && "{ name, arguments, arguments.region }".startsWith(e.label.replace(/…$/, ""))));
  // A script-breaking sequence in a label cannot close the data block.
  assert.ok(!html.slice(html.indexOf('id="vg-data">')).split("</script>")[0].includes("<"));
});

test("Modify: a revision prompt carries the previous proposal and the person's words, verbatim", () => {
  const p = buildProposePrompt(next, [], [], { previous: { groups: [{ id: "g1", kind: "host", label: "box", wraps: ["cluster:web:."], evidence: [] }], names: {} }, guidance: "split the Volt host from the relay" });
  assert.match(p, /The person asked you to revise your previous proposal/);
  assert.match(p, /"split the Volt host from the relay"/);
  assert.match(p, /"id":"g1"/);
  assert.doesNotMatch(buildProposePrompt(next, [], []), /asked you to revise/);
});

test("the architecture command: zero-token map, then propose → modify → ratify through the stub, then nothing to decide", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-arch-cli-"));
  try {
    const root = join(tmp, "nd");
    cpSync(join(ROOT, "test/fixtures/webstack/next_demo"), root, { recursive: true });
    const run = (...args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/cli/main.mjs"), "architecture", root, ...args], {
      encoding: "utf-8", env: { ...process.env, VG_CLAUDE_BIN: STUB },
    });
    let r = run();
    assert.equal(r.status, 0, r.stderr);
    const out = join(root, ".vibegraph", "architecture-map");
    for (const f of ["architecture.md", "architecture.vibegraph.json", "architecture.json", "architecture.html"]) assert.ok(existsSync(join(out, f)), f);
    assert.ok(!existsSync(join(out, "architecture.archify.json")), "Archify's file is opt-in (--archify); ours is the system map");
    assert.ok(!existsSync(join(root, ".vibegraph", "architecture.json")), "no flag writes no stated file");

    r = run("--propose");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /this spends tokens/);
    assert.match(r.stdout, /group g-volt \(host\) "Volt host" wraps cluster:scripts:\. — INFERRED, no evidence/);
    assert.match(r.stdout, /refused group g-invented/);
    assert.match(r.stdout, /a proposal is pending/);

    r = run("--modify", "call it the operator network");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /"public network \(revised\)"/, "Modify really re-drafts");

    r = run("--ratify");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /now STATED/);
    const stored = JSON.parse(readFileSync(join(root, ".vibegraph", "architecture.json"), "utf-8"));
    assert.equal(stored.proposal, undefined);
    assert.equal(stored.groups.find((g) => g.id === "g-public").label, "public network (revised)");
    // The ratified group reads as STATED in the agent's page.
    assert.match(readFileSync(join(out, "architecture.md"), "utf-8"), /\*\*public network \(revised\)\*\* \(network\) — \*\*stated\*\*/);
    r = run("--archify");
    assert.equal(r.status, 0, r.stderr);
    const archify = JSON.parse(readFileSync(join(out, "architecture.archify.json"), "utf-8"));
    assert.ok(validate(archify));
    assert.ok(archify.boundaries.some((b) => b.label === "public network (revised) (network)"));

    r = run("--reject");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no pending architecture proposal/);
    r = run("--modify", "anything");
    assert.equal(r.status, 1, "there is nothing to modify once ratified");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("export writes architecture.md by default; --architecture adds the map as data and as a picture; --archify only on request", () => {
  const tmp = mkdtempSync(join(tmpdir(), "vg-arch-export-"));
  try {
    const root = join(tmp, "nd");
    cpSync(join(ROOT, "test/fixtures/webstack/next_demo"), root, { recursive: true });
    const out = join(tmp, "out");
    const exp = (dir, ...flags) => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts/export_knowledge.mjs"), root, "--out", dir, "--commit", "abc1234", ...flags], { encoding: "utf-8" });
    const plain = join(tmp, "plain");
    exp(plain);
    assert.ok(existsSync(join(plain, "architecture.md")), "the system map as prose is part of the default bundle");
    for (const f of ["architecture.vibegraph.json", "architecture.html", "architecture.archify.json"]) assert.ok(!existsSync(join(plain, f)), `${f} is opt-in`);
    assert.match(readFileSync(join(plain, "README.md"), "utf-8"), /\*\*`architecture\.md`\*\* \(DERIVED \+ STATED\) — the whole system on one page/);
    exp(out, "--architecture");
    for (const f of ["architecture.md", "architecture.vibegraph.json", "architecture.json", "architecture.html"]) assert.ok(existsSync(join(out, f)), f);
    assert.ok(!existsSync(join(out, "architecture.archify.json")));
    assert.match(readFileSync(join(out, "README.md"), "utf-8"), /\*\*The system map as data:\*\* `architecture\.vibegraph\.json`/);
    const both = join(tmp, "both");
    exp(both, "--architecture", "--archify");
    assert.ok(validate(JSON.parse(readFileSync(join(both, "architecture.archify.json"), "utf-8"))), "the Archify file still validates when asked for");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
