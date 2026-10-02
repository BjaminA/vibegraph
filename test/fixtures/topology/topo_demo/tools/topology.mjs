#!/usr/bin/env node
// This project's topology generator: reads the catalogues the code runs on and
// prints them in VibeGraph's topology schema, citing each declaration's line.
import { readFileSync } from "node:fs";
import { STORE, ZONES } from "../catalogue/zones.mjs";
import { PRINCIPALS, GRANTS } from "../catalogue/principals.mjs";
import { REQUEST_STATES, VERDICT_TREE } from "../catalogue/rules.mjs";

const lines = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf-8").split("\n");
const citeOf = (f, needle) => { const i = lines(f).findIndex((l) => l.includes(needle)); return i < 0 ? undefined : `${f}:${i + 1}`; };

const topology = {
  version: "1",
  stores: [{ ...STORE, cite: citeOf("catalogue/zones.mjs", "STORE") }],
  zones: ZONES.map((z) => ({ id: z.id, store: STORE.id, holds: z.holds, cite: citeOf("catalogue/zones.mjs", `id: \"${z.id}\"`) })),
  families: ["request", "verdict", "inspection"].map((id) => ({ id })).concat([{ id: "reading", pattern: "reading-*" }]),
  principals: PRINCIPALS.map((p) => ({ ...p, cite: citeOf("catalogue/principals.mjs", `id: \"${p.id}\"`) })),
  grants: GRANTS.map((g) => ({ ...g, cite: citeOf("catalogue/principals.mjs", `who: \"${g.who}\", zone: \"${g.zone}\"`) })),
  routers: [{ function: "zoneFor", file: "src/router.ts", zones: ZONES.map((z) => z.id), cite: citeOf("src/router.ts", "export function zoneFor") }],
  stateMachines: [{ id: "request", family: "request", evaluatedBy: "decide", transitions: REQUEST_STATES.map((t) => ({ ...t, cite: citeOf("catalogue/rules.mjs", `from: \"${t.from}\", to: \"${t.to}\"`) })) }],
  decisionTrees: [{ id: "verdict", root: VERDICT_TREE.root, cite: citeOf("catalogue/rules.mjs", "VERDICT_TREE"), nodes: VERDICT_TREE.nodes.map((n) => ({ ...n, cite: citeOf("catalogue/rules.mjs", `id: \"${n.id}\"`) })) }],
};
process.stdout.write(JSON.stringify(topology, null, 2) + "\n");
