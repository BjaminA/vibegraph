// What an arrow carries (2026-10-07, src/shared/call_flow.ts): a call site's
// arguments and the names its result is bound to, and the data-flow lines
// between calls of one function. Both the code view and the thread view
// read call sites through this module.
//
//   npm run test:call-flow
import { test } from "node:test";
import assert from "node:assert/strict";
import { callIO, ioLabel, namesRead, dataFlows, scopeOf } from "../src/shared/call_flow.ts";

test("callIO: an unpacking binds every target, a plain call binds nothing", () => {
  assert.deepEqual(callIO({ id: "a", type: "assignment", name: "?", targets: ["xs", "*rest"], args: ["path"] }),
    { args: ["path"], binds: ["xs", "rest"] });
  assert.deepEqual(callIO({ id: "b", type: "assignment", name: "model", args: [] }), { args: [], binds: ["model"] });
  // an attribute target is not a name a later call can read
  assert.deepEqual(callIO({ id: "c", type: "assignment", name: "self.model", args: [] }).binds, []);
  assert.deepEqual(callIO({ id: "d", type: "call", name: "print", args: ["x"] }).binds, []);
});

test("ioLabel: in, then out; either side alone", () => {
  assert.equal(ioLabel({ args: ["a", "b"], binds: ["c"] }), "a, b → c");
  assert.equal(ioLabel({ args: [], binds: ["c"] }), "→ c");
  assert.equal(ioLabel({ args: ["a"], binds: [] }), "a");
  assert.equal(ioLabel({ args: [], binds: [] }), "");
});

test("namesRead: subscripts and attributes read the head; strings and kwarg names do not count", () => {
  assert.deepEqual(namesRead("train_x[batch]"), ["train_x", "batch"]);
  assert.deepEqual(namesRead("x.shape"), ["x"]);
  assert.deepEqual(namesRead("lr=rate"), ["rate"]);
  assert.deepEqual(namesRead('"train_x"'), []);
  assert.deepEqual(namesRead("None"), []);
});

test("dataFlows: the latest earlier binding takes the flow, one function at a time", () => {
  const io = (args, binds) => ({ args, binds });
  const flows = dataFlows([
    { key: "load", scope: "main", line: 2, io: io([], ["xs", "ys"]) },
    { key: "build", scope: "main", line: 3, io: io([], ["model"]) },
    { key: "rebuild", scope: "main", line: 4, io: io(["model"], ["model"]) },
    { key: "train", scope: "main", line: 5, io: io(["model", "xs[0]", "ys"], []) },
    // a different function never takes main's names
    { key: "other", scope: "helper", line: 9, io: io(["xs"], []) },
  ]);
  const by = Object.fromEntries(flows.map((f) => [`${f.from}->${f.to}`, f.names]));
  assert.deepEqual(by["load->train"], ["xs", "ys"]);
  assert.deepEqual(by["rebuild->train"], ["model"]);
  assert.deepEqual(by["build->rebuild"], ["model"]);
  assert.equal(by["build->train"], undefined, "the rebinding in between takes the flow");
  assert.equal(flows.some((f) => f.to === "other"), false);
});

test("scopeOf: nearest function, else the module", () => {
  const byId = new Map([
    ["m/f.fn", { id: "m/f.fn", type: "function_def" }],
    ["m/f.fn/if@0", { id: "m/f.fn/if@0", type: "if_stmt", parentId: "m/f.fn" }],
    ["m/f.fn/if@0/call@0", { id: "m/f.fn/if@0/call@0", type: "call", parentId: "m/f.fn/if@0" }],
    ["m/call@1", { id: "m/call@1", type: "call", parentId: null }],
  ]);
  assert.equal(scopeOf("m/f.fn/if@0/call@0", byId), "m/f.fn");
  assert.equal(scopeOf("m/call@1", byId), "module");
});
