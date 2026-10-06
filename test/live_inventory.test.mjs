// LIVE NEXT TO DECLARED (2026-10-06, direction review M8). The reviewed
// project declared 51 zones and its platform had provisioned 41; the map said
// "51 zones" and nothing else. A project's own read-only listing tool prints
// an INVENTORY — resources with names and aliases, and the identity it read
// as — and `topology live --command|--from` now takes that as well as a whole
// topology. Pinned: zones are matched to live resources by name only (the
// id, a `<prefix>-<zone>` name, a placeholder zone like `request_{Role}`);
// the CLI and `topology show` say "N declared · M provisioned", list the
// never-provisioned zones and the live resources nothing declares, and count
// the identities; the store card on the map says the same; and a catalogue
// word (`owner-of-entry`, `any-writer`) is never counted as a writer.
//
//   npm run test:live-inventory
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readInventory, countLive, isCatalogueWord } from "../src/shared/live_inventory.ts";
import { topologyState } from "../src/server/topology_server.ts";
import { enrichReal } from "../src/webview/system/arch_real.ts";

let tmp, root;
const cli = (...args) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/cli/main.mjs", "topology", ...args, "--root", root], { encoding: "utf-8" });
// the shape a platform's own listing tool prints (one identity, a row per resource)
const INVENTORY = {
  config: "acme.config.json", identity: "did:example:reader",
  resources: [
    { name: "acme-requests", aliases: ["@acme-requests"], id: "0b6c1f2e-1111-4a3b-9c1d-000000000001", documents: [] },
    { name: "acme-verdicts", aliases: ["@acme-verdicts"], id: "0b6c1f2e-1111-4a3b-9c1d-000000000002", documents: [] },
    { name: "acme-scratch", aliases: [], id: "0b6c1f2e-1111-4a3b-9c1d-000000000003", documents: [] },
  ],
};
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "vg-live-"));
  root = join(tmp, "p");
  cpSync("test/fixtures/topology/topo_demo", root, { recursive: true });
  rmSync(join(root, ".vibegraph/topology/live.json"));
  writeFileSync(join(tmp, "inventory.json"), JSON.stringify(INVENTORY));
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test("an inventory is read generically and matched to zones by name only", () => {
  const inv = readInventory(INVENTORY);
  assert.equal(inv.resources.length, 3);
  assert.deepEqual(inv.identities, ["did:example:reader"]);
  const zones = [{ id: "status", store: "s" }, { id: "request_{Role}__{Person}", store: "s" }, { id: "orders", store: "s", label: "bucket <alias>-orders-2" }, { id: "core", store: "s" }];
  const c = countLive(zones, { resources: [["acme-status"], ["acme-request_ops_team__kim"], ["acme-orders-2"], ["acme-corelist"]], identities: [] });
  assert.deepEqual(c.provisioned, ["status", "request_{Role}__{Person}", "orders"]);
  assert.deepEqual(c.missing, ["core"], "acme-corelist is not the core zone");
  assert.deepEqual(c.undeclared, ["acme-corelist"]);
  assert.equal(readInventory({ nothing: [1, 2] }), null);
  assert.ok(isCatalogueWord("owner-of-entry") && isCatalogueWord("any-writer") && !isCatalogueWord("svc-intake"));
});

test("topology live --from counts declared vs provisioned; show says the same", () => {
  const r = cli("live", "--from", join(tmp, "inventory.json"));
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stdout, /^3 declared · 2 provisioned · 1 live identity/);
  assert.match(r.stdout, /Declared, never provisioned \(1\):\n  evidence/);
  assert.match(r.stdout, /Live, not declared \(1\):\n  acme-scratch/);
  const show = cli("show");
  assert.match(show.stdout, /## Live[\s\S]*3 declared · 2 provisioned[\s\S]*Never provisioned: evidence/);
  assert.equal(cli("live", "--from", join(tmp, "nope.json")).status, 2);
});

test("the store card says declared next to provisioned; a catalogue word is no writer", () => {
  const st = topologyState(root);
  assert.equal(st.inventory.inventory.resources.length, 3);
  const t = structuredClone(st.model.topology);
  t.grants = [...(t.grants ?? []), { who: "owner-of-entry", zone: "requests", access: "write" }];
  const real = enrichReal({ nodes: [], edges: [], groups: [] }, { topology: t, inventory: st.inventory });
  const card = real.nodes.find((n) => n.id === "store:docs");
  assert.match(card.sublabel, /^3 declared · 2 provisioned/);
  assert.ok(card.notes.some((x) => /never provisioned: evidence/.test(x)));
  assert.ok(card.notes.some((x) => /read as 1 identity/.test(x)));
  assert.ok(!card.notes.join(" ").includes("owner-of-entry"), "a catalogue word is a rule, not a writer");
});
