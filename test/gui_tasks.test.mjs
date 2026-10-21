// The app's model tasks (2026-10-21): the server owns a token-spending task to
// its end and says its steps (src/server/gui_tasks.ts); a model's stream is
// read into those steps (src/server/llm_stream.ts); the Brief's pending groups
// are drawn on the map before a person decides them
// (src/server/brief_group_preview.ts).
//
//   npm run test:gui-tasks
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuiTasks } from "../src/server/gui_tasks.ts";
import { newStreamState, streamResult, streamStep, toolStep } from "../src/server/llm_stream.ts";
import { withBriefGroupPreview } from "../src/server/brief_group_preview.ts";
import { buildPolyglotEnvelope } from "../scripts/regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildCrossingIndex } from "../src/server/crossings.ts";
import { archModelForEnvelope } from "../src/server/arch_envelope.ts";
import { applyArchStore, loadArchStore } from "../src/server/arch_store.ts";

test("a task is the server's: one of a kind at a time, its steps said, its end kept with its result", () => {
  const said = [];
  let t = 0;
  const tasks = createGuiTasks((list) => said.push(list), () => new Date(Date.UTC(2026, 9, 21, 10, 0, t++)));
  const a = tasks.start("rules", "Proposing rules", "rules");
  assert.ok(!("refused" in a));
  assert.equal(said.at(-1)[0].state, "running", "a start is said at once");
  assert.match(tasks.start("rules", "again", "rules").refused, /^Proposing rules is already running .*carries on whether its panel is open or not/);
  assert.ok(!("refused" in tasks.start("brief", "Drafting the Brief", "map")), "another kind runs beside it");
  a.step("reading the code's facts");
  a.step("thinking", true);
  a.step("thinking: 1,200 characters", true);
  a.step("writing the reply: 300 characters", true);
  a.step("checking the reply against the facts");
  assert.deepEqual(tasks.running("rules").steps.map((s) => s.text), ["reading the code's facts", "writing the reply: 300 characters", "checking the reply against the facts"], "a live counter replaces the one before it");
  a.done("2 rules proposed", { stored: ["c7", "c8"] });
  const done = tasks.list().find((x) => x.kind === "rules");
  assert.equal(done.state, "done");
  assert.deepEqual(done.result, { stored: ["c7", "c8"] }, "the result waits for the panel that reopens");
  a.step("late");
  a.fail("late");
  assert.equal(tasks.list().find((x) => x.kind === "rules").state, "done", "an ended task does not change");
  assert.ok(!("refused" in tasks.start("rules", "Proposing rules", "rules")), "a new one may start once it ended");
  tasks.dismiss(done.id);
  assert.equal(tasks.list().filter((x) => x.id === done.id).length, 0);
});

test("only the last finished tasks are kept; running ones always are", () => {
  let t = 0;
  const tasks = createGuiTasks(() => {}, () => new Date(Date.UTC(2026, 9, 21, 10, 0, 0, t++)));
  for (let i = 0; i < 9; i++) { const h = tasks.start("groups", `run ${i}`, "map"); h.done(`done ${i}`); }
  tasks.start("brief", "running", "map");
  const list = tasks.list();
  assert.equal(list.filter((x) => x.state === "done").length, 6);
  assert.equal(list.filter((x) => x.state === "running").length, 1);
  assert.equal(list.find((x) => x.state === "done").label, "run 3", "the oldest go first");
});

test("a model's stream becomes the steps the app shows; the result is found as before", () => {
  const st = newStreamState();
  const line = (o) => JSON.stringify(o);
  assert.deepEqual(streamStep(line({ type: "system", subtype: "init", model: "claude-opus-5-5" }), st, 0), { text: "the model is claude-opus-5-5", live: false });
  assert.deepEqual(streamStep(line({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "thinking" } } }), st, 0), { text: "thinking", live: true });
  // a real run's thinking arrived with no text: it stays "thinking", never "0 characters"
  assert.equal(streamStep(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "" } } }), st, 1500), null);
  const delta = (text, at) => streamStep(line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } }), st, at);
  assert.deepEqual(delta("x".repeat(1500), 2000), { text: "writing the reply: 1,500 characters", live: true });
  assert.equal(delta("y", 2500), null, "a counter at most once a second");
  assert.deepEqual(delta("z", 3100), { text: "writing the reply: 1,502 characters", live: true });
  assert.deepEqual(streamStep(line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/app.ts" } }] } }), st, 0), { text: "reading src/app.ts", live: false });
  assert.equal(toolStep("Grep", { pattern: "writeStatus" }), "searching the code for writeStatus");
  assert.equal(streamStep("not json", st, 0), null);
  const out = [line({ type: "system", subtype: "init" }), line({ type: "result", result: "the reply", is_error: false, total_cost_usd: 0.1 })].join("\n");
  assert.equal(streamResult(out).result, "the reply");
  assert.equal(streamResult(JSON.stringify({ result: "a stub's one object" })).result, "a stub's one object", "the json format, and every stub");
  assert.equal(streamResult("nothing"), null);
});

const tmp = mkdtempSync(join(tmpdir(), "vg-brief-groups-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("the Brief's pending groups are drawn on the map, dashed, before a person decides them", () => {
  const root = join(tmp, "fleet");
  cpSync("examples/fleet-telemetry", root, { recursive: true, filter: (p) => !p.includes("__pycache__") && !p.endsWith(".db") });
  const env = buildPolyglotEnvelope(root, { skipSystem: true }).envelope;
  const derived = archModelForEnvelope(env, buildStackIndex(env, root), buildCrossingIndex(env), root, undefined, { applyStore: false });
  const model = applyArchStore(derived, loadArchStore(root));
  const boxes = derived.nodes.filter((n) => n.kind === "cluster").map((n) => n.id).slice(0, 2);
  assert.equal(boxes.length, 2, "the example has process boxes");
  assert.equal(withBriefGroupPreview(model, derived, root), model, "no pending Brief: the model as it is");
  mkdirSync(join(root, ".vibegraph"), { recursive: true });
  writeFileSync(join(root, ".vibegraph", "brief.json"), JSON.stringify({
    version: "1",
    proposed: {
      model: "test", at: "2026-10-21T10:00:00.000Z", refused: [], hashes: {},
      spec: { function: [], method: [], feature: [] }, scopes: [],
      groups: [{ op: "add", id: "g-ingest", label: "Ingest side", kind: "process", members: boxes, cites: [] }], names: {},
    },
  }));
  const shown = withBriefGroupPreview(model, derived, root);
  const g = shown.groups.find((x) => x.id === "g-ingest");
  assert.ok(g, "the proposed group is on the map");
  assert.equal(g.source, "proposed", "drawn dashed: not decided yet");
  assert.deepEqual([...g.wraps].sort(), [...boxes].sort());
  assert.deepEqual(shown.briefGroups, { changes: shown.groups.filter((x) => x.source === "proposed").length, names: 0, model: "test" });
  assert.equal(model.groups.some((x) => x.id === "g-ingest"), false, "the model itself is not changed (transport only)");
  assert.equal(withBriefGroupPreview({ ...model, proposal: { at: "", model: "m", narrative: null, refused: [] } }, derived, root).briefGroups, undefined, "an architecture proposal of its own is not mixed with it");
});
