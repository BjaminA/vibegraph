/**
 * M-TRAINED.1 — artifact index, pinned:
 * write/read classification off call names + artifact-extension literals
 * (args AND preview), thread attribution via the enclosing .fn prefix
 * (module-level sites → threads seeded in the file), exists/stale off the
 * injected stat (stale = newest producer source newer than the artifact),
 * ambiguous calls and data extensions IGNORED, sites with no walking
 * thread still recorded.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/artifact_index.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as artifactMod from "../src/server/artifact_index.ts";
import { buildArtifactIndex, enclosingFnId, isArtifactPath } from "../src/server/artifact_index.ts";

// train.py: main() saves model.pkl; module-level torch.save of scaler.pt.
// predict.py: predict() loads model.pkl (as an assignment call).
const FILES = {
  "train.py": {
    nodes: [
      { id: "module/main.fn", type: "function_def", line: 3 },
      { id: "module/main.fn/pickle.dump.call", type: "call", line: 9, funcName: "pickle.dump", args: ["weights", 'open("model.pkl", "wb")'] },
      { id: "module/torch.save.call", type: "call", line: 14, funcName: "torch.save", args: ["scaler", '"scaler.pt"'] },
      // Data read — csv is NOT an artifact extension; must not appear.
      { id: "module/main.fn/load_rows.call", type: "call", line: 5, funcName: "load_rows", args: ['"data/pump.csv"'] },
      // Ambiguous call name naming an artifact literal — ignored by design.
      { id: "module/main.fn/register.call", type: "call", line: 11, funcName: "register", args: ['"model.pkl"'] },
    ],
  },
  "predict.py": {
    nodes: [
      { id: "module/predict.fn", type: "function_def", line: 3 },
      { id: "module/predict.fn/model.assign", type: "assignment", line: 5, valueKind: "call", callTarget: "pickle.load", preview: 'pickle.load(open("model.pkl", "rb"))' },
    ],
  },
};

const THREADS = [
  {
    entryPointId: "train.py:main",
    seed: { file: "train.py", qualifiedName: "train:main" },
    filesReached: ["train.py"],
    nodes: [{ id: "train:main", kind: "seed", file: "train.py", irNodeId: "module/main.fn" }],
  },
  {
    entryPointId: "predict.py:predict",
    seed: { file: "predict.py", qualifiedName: "predict:predict" },
    filesReached: ["predict.py"],
    nodes: [{ id: "predict:predict", kind: "seed", file: "predict.py", irNodeId: "module/predict.fn" }],
  },
];

const statAll = (overrides = {}) => (rel) =>
  overrides[rel] ?? { exists: false, mtimeMs: null };

test("enclosingFnId follows the structural grammar", () => {
  assert.equal(enclosingFnId("module/main.fn/pickle.dump.call"), "module/main.fn");
  assert.equal(enclosingFnId("module/Shape.class/area.fn/return@0"), "module/Shape.class/area.fn");
  assert.equal(enclosingFnId("module/torch.save.call"), null);
  assert.equal(enclosingFnId("module/main.fn/for@0/x.call"), "module/main.fn");
});

test("producers and consumers map to the threads that walk them; data/ambiguous sites ignored", () => {
  const idx = buildArtifactIndex({ threads: THREADS, files: FILES, statFile: statAll() });
  const paths = idx.map((r) => r.path);
  assert.deepEqual(paths, ["model.pkl", "scaler.pt"]);

  const model = idx.find((r) => r.path === "model.pkl");
  assert.equal(model.producers.length, 1);
  assert.equal(model.producers[0].entryPointId, "train.py:main");
  assert.equal(model.producers[0].call, "pickle.dump");
  assert.equal(model.consumers.length, 1);
  assert.equal(model.consumers[0].entryPointId, "predict.py:predict");
  assert.equal(model.exists, false);
  assert.equal(model.stale, false);
});

test("a module-level write attributes to threads seeded in its file", () => {
  const idx = buildArtifactIndex({ threads: THREADS, files: FILES, statFile: statAll() });
  const scaler = idx.find((r) => r.path === "scaler.pt");
  assert.equal(scaler.producers[0].entryPointId, "train.py:main");
  assert.deepEqual(scaler.consumers, []);
});

test("stale = a producer source file newer than the artifact, with the file named", () => {
  const stat = statAll({
    "model.pkl": { exists: true, mtimeMs: 1000 },
    "train.py": { exists: true, mtimeMs: 2000 },
    "predict.py": { exists: true, mtimeMs: 500 },
  });
  const idx = buildArtifactIndex({ threads: THREADS, files: FILES, statFile: stat });
  const model = idx.find((r) => r.path === "model.pkl");
  assert.equal(model.exists, true);
  assert.equal(model.stale, true);
  assert.match(model.staleReason, /train\.py changed after/);
});

test("fresh artifact: exists, not stale, no reason", () => {
  const stat = statAll({
    "model.pkl": { exists: true, mtimeMs: 3000 },
    "train.py": { exists: true, mtimeMs: 2000 },
  });
  const model = buildArtifactIndex({ threads: THREADS, files: FILES, statFile: stat })
    .find((r) => r.path === "model.pkl");
  assert.equal(model.stale, false);
  assert.equal(model.staleReason, null);
});

test("a site no thread walks is still recorded (empty attribution, never invisible)", () => {
  const idx = buildArtifactIndex({ threads: [], files: FILES, statFile: statAll() });
  const model = idx.find((r) => r.path === "model.pkl");
  assert.equal(model.producers.length, 1);
  assert.equal(model.producers[0].entryPointId, "");
});

test("detectMissingArtifacts: offense lines naming a missing artifact answer with the PRODUCER, never a draft", () => {
  const { detectMissingArtifacts } = artifactMod;
  const idx = buildArtifactIndex({ threads: THREADS, files: FILES, statFile: statAll() });
  const offenses = [
    { file: "predict.py", line: 5 },      // pickle.load line → model.pkl
    { file: "predict.py", line: 99 },     // no such line
  ];
  const readLine = (file, line) =>
    file === "predict.py" && line === 5 ? 'model = pickle.load(open("model.pkl", "rb"))' : null;
  const out = detectMissingArtifacts(offenses, idx, readLine, statAll());
  assert.equal(out.length, 1);
  assert.equal(out[0].path, "model.pkl");
  assert.equal(out[0].producers[0].entryPointId, "train.py:main");
});

test("detectMissingArtifacts: an artifact that EXISTS is not reported", () => {
  const { detectMissingArtifacts } = artifactMod;
  const idx = buildArtifactIndex({ threads: THREADS, files: FILES, statFile: statAll() });
  const out = detectMissingArtifacts(
    [{ file: "predict.py", line: 5 }],
    idx,
    () => 'model = pickle.load(open("model.pkl", "rb"))',
    statAll({ "model.pkl": { exists: true, mtimeMs: 1 } }),
  );
  assert.deepEqual(out, []);
});

test("missingArtifactFor: post-run FNF path resolves producers (empty when unknown — honest, not silent)", () => {
  const { missingArtifactFor } = artifactMod;
  const idx = buildArtifactIndex({ threads: THREADS, files: FILES, statFile: statAll() });
  assert.equal(missingArtifactFor(idx, "model.pkl").producers[0].qualifiedName, "train:main");
  assert.deepEqual(missingArtifactFor(idx, "other.pt").producers, []);
});

// Sitting-2 — the pump-lab shape that escaped detection: the artifact path
// lives ONLY in the enclosing function's default param, and the save/load
// call passes the param NAME (`torch.save(model.state_dict(), weights_path)`
// under `def main(..., weights_path="model.pt")`).
test("a plain-name arg resolves through the enclosing function's default-param artifact literal", () => {
  const files = {
    "train.py": {
      nodes: [
        { id: "module/main.fn", type: "function_def", line: 51, params: ["epochs=50", 'weights_path="model.pt"'] },
        { id: "module/main.fn/torch_save.call", type: "call", line: 62, funcName: "torch.save", args: ["model.state_dict()", "weights_path"] },
      ],
    },
    "predict.py": {
      nodes: [
        { id: "module/load_trained_model.fn", type: "function_def", line: 31, params: ['weights_path="model.pt"'] },
        { id: "module/load_trained_model.fn/torch_load.call", type: "call", line: 33, funcName: "torch.load", args: ["weights_path"] },
        // A NON-param name must not resolve (no default carries it).
        { id: "module/load_trained_model.fn/np_load.call", type: "call", line: 34, funcName: "np.load", args: ["other_path"] },
      ],
    },
  };
  const threads = [
    {
      entryPointId: "train.py:main",
      seed: { file: "train.py", qualifiedName: "train:main" },
      filesReached: ["train.py"],
      nodes: [{ id: "train:main", kind: "seed", file: "train.py", irNodeId: "module/main.fn" }],
    },
  ];
  const idx = buildArtifactIndex({ threads, files, statFile: statAll() });
  assert.deepEqual(idx.map((r) => r.path), ["model.pt"]);
  const rec = idx[0];
  assert.equal(rec.producers.length, 1);
  assert.equal(rec.producers[0].entryPointId, "train.py:main");
  assert.equal(rec.producers[0].call, "torch.save");
  // torch.load(weights_path) in predict.py → consumer (no walking thread →
  // empty attribution, still recorded).
  assert.equal(rec.consumers.length, 1);
  assert.equal(rec.consumers[0].call, "torch.load");
  // Post-run FNF tier now names the producer for the sitting's exact path.
  const { missingArtifactFor } = artifactMod;
  assert.equal(missingArtifactFor(idx, "model.pt").producers[0].qualifiedName, "train:main");
});

test("isArtifactPath: artifact extensions yes, data extensions no", () => {
  assert.ok(isArtifactPath("model.pt"));
  assert.ok(isArtifactPath("weights/best.ckpt"));
  assert.ok(!isArtifactPath("data/pump.csv"));
  assert.ok(!isArtifactPath("cache.npz"));
});

// Sitting-3 — the pump-lab shape where ONE thread consumes an artifact at
// TWO sites: evaluate_holdout calls `load_model(model_path)` (site A, in its
// own body) AND its thread walks INTO load_model, whose `torch.load(model_path)`
// is site B — both resolve model.pt via the enclosing default-param and both
// attribute to the evaluate_holdout thread. The index keeps both sites (by
// design); the "consumed by" line must name the thread ONCE.
test("consumerThreadNames: one thread consuming at two sites is named once", () => {
  const { consumerThreadNames } = artifactMod;
  const files = {
    "predict.py": {
      nodes: [
        // load_model(model_path="model.pt"): torch.load(model_path) → site B.
        { id: "module/load_model.fn", type: "function_def", line: 60, params: ['model_path="model.pt"'] },
        { id: "module/load_model.fn/torch_load.call", type: "call", line: 62, funcName: "torch.load", args: ["model_path"] },
        // evaluate_holdout(model_path="model.pt"): load_model(model_path) → site A.
        { id: "module/evaluate_holdout.fn", type: "function_def", line: 90, params: ['model_path="model.pt"'] },
        { id: "module/evaluate_holdout.fn/model.assign", type: "assignment", line: 97, valueKind: "call", callTarget: "load_model", args: ["model_path"] },
      ],
    },
  };
  // The evaluate_holdout thread walks its own body AND steps into load_model.
  const threads = [
    {
      entryPointId: "predict.py:evaluate_holdout",
      seed: { file: "predict.py", qualifiedName: "predict:evaluate_holdout" },
      filesReached: ["predict.py"],
      nodes: [
        { id: "s", kind: "seed", file: "predict.py", irNodeId: "module/evaluate_holdout.fn" },
        { id: "b", kind: "step", file: "predict.py", irNodeId: "module/load_model.fn" },
      ],
    },
  ];
  const rec = buildArtifactIndex({ threads, files, statFile: statAll() }).find((r) => r.path === "model.pt");
  // Both sites are recorded (per-site is intentional — nav/detection want them).
  assert.equal(rec.consumers.length, 2, JSON.stringify(rec.consumers.map((c) => c.nodeId)));
  assert.ok(rec.consumers.every((c) => c.entryPointId === "predict.py:evaluate_holdout"));
  // …but the human-facing "consumed by" list names the thread ONCE.
  assert.deepEqual(consumerThreadNames(rec.consumers), ["predict:evaluate_holdout"]);
});

test("consumerThreadNames: distinct threads kept; empty-attribution sites dropped", () => {
  const { consumerThreadNames } = artifactMod;
  const consumers = [
    { entryPointId: "a", qualifiedName: "mod:a", file: "f", line: 1, nodeId: "n1", call: "torch.load" },
    { entryPointId: "a", qualifiedName: "mod:a", file: "f", line: 2, nodeId: "n2", call: "torch.load" },
    { entryPointId: "b", qualifiedName: "mod:b", file: "f", line: 3, nodeId: "n3", call: "torch.load" },
    { entryPointId: "", qualifiedName: "", file: "f", line: 4, nodeId: "n4", call: "torch.load" },
  ];
  assert.deepEqual(consumerThreadNames(consumers), ["mod:a", "mod:b"]);
  assert.deepEqual(consumerThreadNames([]), []);
});

// Sitting-3 — the pump-lab-3 build shape: the builder minted a module
// constant (`MODEL_PATH = "model.pt"`), used it as a param DEFAULT in two
// files (imported in one), and passed the param name to torch.save/load.
// No artifact literal appears in any call arg or default — resolution must
// go name → module constant → literal, project-wide, still lexically.
test("param defaults and call args naming a module-level constant resolve to its artifact literal", () => {
  const files = {
    "train.py": {
      nodes: [
        { id: "module/MODEL_PATH.assign", type: "assignment", line: 17, preview: '"model.pt"' },
        { id: "module/main.fn", type: "function_def", line: 100, params: ["csv_path=None", "epochs=100", "model_path=MODEL_PATH"] },
        { id: "module/main.fn/torch.save.call", type: "call", line: 121, funcName: "torch.save", args: ["model.state_dict()", "model_path"] },
      ],
    },
    "predict.py": {
      nodes: [
        // MODEL_PATH is imported from train — the constant map is project-wide.
        { id: "module/load_model.fn", type: "function_def", line: 88, params: ["model_path=MODEL_PATH"] },
        { id: "module/load_model.fn/torch.load.call", type: "call", line: 91, funcName: "torch.load", args: ["model_path"] },
      ],
    },
  };
  const threads = [
    {
      entryPointId: "train.py:main",
      seed: { file: "train.py", qualifiedName: "train:main" },
      filesReached: ["train.py"],
      nodes: [{ id: "s", kind: "seed", file: "train.py", irNodeId: "module/main.fn" }],
    },
    {
      entryPointId: "predict.py:evaluate_holdout",
      seed: { file: "predict.py", qualifiedName: "predict:evaluate_holdout" },
      filesReached: ["predict.py"],
      nodes: [{ id: "b", kind: "step", file: "predict.py", irNodeId: "module/load_model.fn" }],
    },
  ];
  const rec = buildArtifactIndex({ threads, files, statFile: statAll() }).find((r) => r.path === "model.pt");
  assert.ok(rec, "model.pt must be indexed via the constant");
  assert.deepEqual(rec.producers.map((p) => p.qualifiedName), ["train:main"]);
  assert.deepEqual(rec.consumers.map((c) => c.qualifiedName), ["predict:evaluate_holdout"]);
});

test("a module constant bound to two different literals is ambiguous and resolves nothing", () => {
  const files = {
    "a.py": {
      nodes: [
        { id: "module/MODEL_PATH.assign", type: "assignment", line: 1, preview: '"model.pt"' },
        { id: "module/save.fn", type: "function_def", line: 3, params: [] },
        { id: "module/save.fn/torch.save.call", type: "call", line: 4, funcName: "torch.save", args: ["sd", "MODEL_PATH"] },
      ],
    },
    "b.py": {
      nodes: [
        { id: "module/MODEL_PATH.assign", type: "assignment", line: 1, preview: '"other.pt"' },
      ],
    },
  };
  assert.deepEqual(buildArtifactIndex({ threads: [], files, statFile: statAll() }), []);
});

test("a constant whose preview is an expression around the literal is NOT resolved", () => {
  const files = {
    "a.py": {
      nodes: [
        { id: "module/MODEL_PATH.assign", type: "assignment", line: 1, preview: 'Path("model.pt")' },
        { id: "module/save.fn/torch.save.call", type: "call", line: 4, funcName: "torch.save", args: ["sd", "MODEL_PATH"] },
      ],
    },
  };
  // The call's arg text itself has no literal; the Path(...) preview stays
  // out of the constant map (expression, not the bare literal).
  const recs = buildArtifactIndex({ threads: [], files, statFile: statAll() });
  assert.deepEqual(recs, []);
});
