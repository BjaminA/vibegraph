/**
 * M26.3 — buildChatPrompt unit test (PLAN-M26 §M26.3).
 *
 * Pins the chat framing that fixes the wrong-file risk: the prompt must
 * state the selected node's TRUE file (not assume the viewed file), keep
 * an unresolvable node id visible instead of silently dropping it, embed
 * the active thread as a cross-file flow, and instruct the agent to pick
 * edit targets from the IR.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/chat_prompt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatPrompt, buildTurnPreamble } from "../src/server/chat/prompt.ts";

const FILES = ["app.py", "cli.py", "db.py", "models.py", "test_flow.py"];

test("cross-file node context states the node's TRUE file, not the viewed one", () => {
  const p = buildChatPrompt({
    userText: "add error handling",
    activeFile: "app.py",
    projectFiles: FILES,
    node: {
      nodeId: "module/query.fn",
      file: "db.py",
      type: "function_def",
      line: 17,
      endLine: 24,
      source: "def query(sql, params=()):\n    ...",
    },
    thread: null,
  });
  assert.match(p, /Selected node: module\/query\.fn \(function_def, lines 17-24\) — in file db\.py/);
  assert.match(p, /currently viewing: app\.py/);
  assert.match(p, /```python\ndef query/);
  assert.match(p, /Project files: app\.py, cli\.py, db\.py, models\.py, test_flow\.py/);
});

test("an unresolvable node id is never silently dropped", () => {
  const p = buildChatPrompt({
    userText: "x",
    activeFile: "app.py",
    projectFiles: FILES,
    node: { nodeId: "module/ghost.fn", file: null },
    thread: null,
  });
  assert.match(p, /Selected node: module\/ghost\.fn — not found in the current parse/);
  assert.match(p, /vibegraph_find_symbol/);
});

test("active thread block: seed + ordered steps as id (file) + terminals", () => {
  const p = buildChatPrompt({
    userText: "x",
    activeFile: "db.py",
    projectFiles: FILES,
    node: null,
    thread: {
      qualifiedName: "app:get_user_route",
      seedFile: "app.py",
      nodes: [
        { id: "app:get_user_route", kind: "seed", label: "get_user_route", file: "app.py" },
        { id: "models:find_user", kind: "step", label: "find_user", file: "models.py" },
        { id: "db:query", kind: "step", label: "query", file: "db.py" },
        { id: "dynamic:conn.execute", kind: "dynamic", label: "conn.execute", file: null },
        { id: "unresolved:vg_audit", kind: "unresolved", label: "vg_audit", file: null },
        { id: "container:x", kind: "container", label: "try", file: null },
      ],
    },
  });
  assert.match(p, /Active thread: app:get_user_route \(seed in app\.py\)/);
  // Ordered, numbered, cross-file — and containers don't leak in.
  const i1 = p.indexOf("1. app:get_user_route (app.py)");
  const i2 = p.indexOf("2. models:find_user (models.py)");
  const i3 = p.indexOf("3. db:query (db.py)");
  assert.ok(i1 > -1 && i2 > i1 && i3 > i2, `steps missing or out of order:\n${p}`);
  assert.match(p, /Terminals: conn\.execute \[dynamic\], vg_audit \[unresolved\]/);
  assert.ok(!p.includes("container:x"), "containers must not appear as steps");
});

test("targeting rules: IR-driven file choice, caller-file inserts, relative paths, no raw patches", () => {
  const p = buildChatPrompt({
    userText: "x",
    activeFile: "app.py",
    projectFiles: FILES,
    node: null,
    thread: null,
  });
  assert.match(p, /Do NOT assume the active file is the edit target/);
  assert.match(p, /vibegraph_find_symbol/);
  assert.match(p, /CALLER's file.*vibegraph_compose_insert/);
  assert.match(p, /relative file paths exactly as vibegraph_list_files returns them/);
  assert.match(p, /never output raw code patches/);
});

test("A3: the grounding contract requires node-id citations + names the validator", () => {
  const p = buildChatPrompt({ userText: "x", activeFile: "app.py", projectFiles: FILES, node: null, thread: null });
  assert.match(p, /Grounding rule/);
  assert.match(p, /cite the IR node id/);
  assert.match(p, /Do NOT assert what you cannot tie to a node/);
  assert.match(p, /vibegraph_validate_citations/);
});

test("C1: a ratified thread-skill is injected, labelled authoritative; absent when no skill", () => {
  const threadBase = {
    qualifiedName: "app:create_user_route", seedFile: "app.py",
    nodes: [{ id: "app:create_user_route", kind: "seed", label: "create_user_route", file: "app.py" }],
  };
  const withSkill = buildChatPrompt({
    userText: "x", activeFile: "app.py", projectFiles: FILES, node: null,
    thread: { ...threadBase, skill: "## Purpose\nCreates a user and persists it." },
  });
  assert.match(withSkill, /Thread skill \(human-ratified guidance/);
  assert.match(withSkill, /Creates a user and persists it/);

  const noSkill = buildChatPrompt({
    userText: "x", activeFile: "app.py", projectFiles: FILES, node: null, thread: threadBase,
  });
  assert.ok(!/Thread skill/.test(noSkill), "no skill block when none is ratified+fresh");
});

// ── M28.3 — node focus / scope directive + thread step-position ──────

test("M28.3: a selected node adds the focus/scope directive; no node → none", () => {
  const withNode = buildChatPrompt({
    userText: "x", activeFile: "db.py", projectFiles: FILES,
    node: { nodeId: "db:query", file: "db.py", type: "function_def", line: 1, endLine: 2 },
    thread: null,
  });
  assert.match(withNode, /focused on the selected node — default to editing ONLY it/);

  const noNode = buildChatPrompt({
    userText: "x", activeFile: "db.py", projectFiles: FILES, node: null, thread: null,
  });
  assert.ok(!noNode.includes("focused on the selected node"), "no scope directive without a selection");
});

test("M28.3: node + thread states the node's step position in the flow", () => {
  const p = buildChatPrompt({
    userText: "x", activeFile: "db.py", projectFiles: FILES,
    node: { nodeId: "db:query", file: "db.py", type: "function_def", line: 1, endLine: 2 },
    thread: {
      qualifiedName: "app:get_user_route",
      seedFile: "app.py",
      nodes: [
        { id: "app:get_user_route", kind: "seed", label: "get_user_route", file: "app.py" },
        { id: "models:find_user", kind: "step", label: "find_user", file: "models.py" },
        { id: "db:query", kind: "step", label: "query", file: "db.py" },
        { id: "dynamic:conn.execute", kind: "dynamic", label: "conn.execute", file: null },
      ],
    },
  });
  assert.match(p, /This node is step 3 of 3 in the active thread/);
});

test("M28.3: a node that isn't a thread step gets no position line", () => {
  const p = buildChatPrompt({
    userText: "x", activeFile: "db.py", projectFiles: FILES,
    node: { nodeId: "db:helper", file: "db.py", type: "function_def", line: 1, endLine: 2 },
    thread: {
      qualifiedName: "app:get_user_route",
      seedFile: "app.py",
      nodes: [{ id: "app:get_user_route", kind: "seed", label: "x", file: "app.py" }],
    },
  });
  assert.ok(!p.includes("This node is step"), "no position when the node isn't a step");
});

test("M28.3: turn preamble re-scopes a new selection and names its step position", () => {
  const thread = {
    qualifiedName: "app:get_user_route",
    seedFile: "app.py",
    nodes: [
      { id: "app:get_user_route", kind: "seed", label: "x", file: "app.py" },
      { id: "db:query", kind: "step", label: "query", file: "db.py" },
    ],
  };
  const p = buildTurnPreamble(
    CTX({ thread }),
    CTX({ thread, node: { nodeId: "db:query", file: "db.py", type: "function_def" } }),
  );
  assert.match(p, /Focus on this node; default to editing only it/);
  assert.match(p, /This node is step 2 of 2 in the active thread/);
});

// ── M27.2 — per-turn deltas ─────────────────────────────────────────

const CTX = (over = {}) => ({
  activeFile: "app.py",
  projectFiles: FILES,
  node: null,
  thread: null,
  ...over,
});

test("M27.2: no change → empty preamble (the user text goes through bare)", () => {
  assert.equal(buildTurnPreamble(CTX(), CTX()), "");
});

test("M27.2: selection change → one delta line naming the node AND its file, no full framing", () => {
  const p = buildTurnPreamble(
    CTX(),
    CTX({ node: { nodeId: "module/query.fn", file: "db.py", type: "function_def" } }),
  );
  assert.match(p, /selection is now: module\/query\.fn — in file db\.py/);
  assert.ok(!p.includes("Targeting rules"), "deltas must not re-send the framing");
  assert.ok(!p.includes("Project files"), "unchanged file list must not re-send");
});

test("M27.2: a re-derived SAME thread is not a switch; a new thread re-sends the block", () => {
  const thread = (qualifiedName) => ({
    qualifiedName,
    seedFile: "app.py",
    nodes: [{ id: qualifiedName, kind: "seed", label: "x", file: "app.py" }],
  });
  // Fresh object, same identity → no delta.
  assert.equal(
    buildTurnPreamble(CTX({ thread: thread("app:get_user_route") }), CTX({ thread: thread("app:get_user_route") })),
    "",
  );
  // Different thread → the full thread block rides the delta.
  const p = buildTurnPreamble(
    CTX({ thread: thread("app:get_user_route") }),
    CTX({ thread: thread("cli:main") }),
  );
  assert.match(p, /Active thread: cli:main/);
});

test("M27.2: cleared selection and changed file list are stated", () => {
  const p = buildTurnPreamble(
    CTX({ node: { nodeId: "module/query.fn", file: "db.py" } }),
    CTX({ node: null, projectFiles: [...FILES, "new_module.py"] }),
  );
  assert.match(p, /cleared their selection/);
  assert.match(p, /Project files now: .*new_module\.py/);
});

test("single-file mode omits the project map; the user request comes last", () => {
  const p = buildChatPrompt({
    userText: "rename the loop variable",
    activeFile: "/abs/sample.py",
    projectFiles: [],
    node: null,
    thread: null,
  });
  assert.ok(!p.includes("Project files:"), "no project map in single-file mode");
  assert.ok(p.trimEnd().endsWith("rename the loop variable"), "user text must be the final line");
});

// ── M-SKILL.2 — remit-routed context ────────────────────────────────

import { renderRoutedBlock } from "../src/server/chat/prompt.ts";

const ROUTED = [
  {
    entryPointId: "db.py:query",
    qualifiedName: "db:query",
    matchedOn: ["`db.query`", "db.py"],
    skill: "Always use _get_conn; never open sqlite3 directly. `module/query.fn`",
  },
  {
    entryPointId: "app.py:create_user_route",
    qualifiedName: "app:create_user_route",
    matchedOn: ["`create_user`"],
    skill: null,
  },
];

test("M-SKILL.2: routed block names each thread, WHY it matched, and the spawn hint", () => {
  const p = buildChatPrompt({ userText: "x", activeFile: null, projectFiles: [], node: null, thread: null, routed: ROUTED });
  assert.match(p, /Routed context — this question touches threads beyond the active one/);
  assert.match(p, /Thread db:query \(entryPointId db\.py:query; matched `db\.query`, db\.py\)/);
  assert.match(p, /Thread skill \(human-ratified guidance for this thread — treat as authoritative\)/);
  assert.ok(p.includes("Always use _get_conn"), "skill body missing");
  assert.match(p, /\(no ratified skill exists for this thread yet\)/);
  assert.match(p, /vibegraph_spawn_thread_agent\(entryPointId, task\)/);
});

test("M-SKILL.2: routed and active-thread blocks coexist with distinct labels", () => {
  const p = buildChatPrompt({
    userText: "x",
    activeFile: null,
    projectFiles: [],
    node: null,
    thread: { qualifiedName: "cli:main", seedFile: "cli.py", nodes: [] },
    routed: [ROUTED[0]],
  });
  const active = p.indexOf("Active thread: cli:main");
  const routed = p.indexOf("Routed context —");
  assert.ok(active > -1 && routed > active, "routed block must follow the active-thread block");
});

test("M-SKILL.2: honest omission lines for over-budget and already-in-session", () => {
  const block = renderRoutedBlock([
    { entryPointId: "a:1", qualifiedName: "a:one", matchedOn: ["`one`"], skill: null, skillOmitted: "over-budget" },
    { entryPointId: "b:2", qualifiedName: "b:two", matchedOn: ["`two`"], skill: null, skillOmitted: "already-in-session" },
  ]);
  assert.match(block, /over this turn's context budget — read it with vibegraph_get_thread_skill/);
  assert.match(block, /already in this session's context — injected on an earlier turn/);
});

test("M-TRAINED.4: artifact-state notes ride the thread block; absent notes leave the prompt untouched", () => {
  const thread = {
    qualifiedName: "predict:predict", seedFile: "predict.py",
    nodes: [{ id: "predict:predict", kind: "seed", label: "predict", file: "predict.py" }],
    artifacts: [
      "model.pkl is MISSING — produced by thread train:main (pickle.dump at train.py:9). Offer to run the producer (vibegraph_run_thread_to_node on its save site, consent-gated); never fabricate this file.",
    ],
  };
  const p = buildChatPrompt({ userText: "x", activeFile: null, projectFiles: [], node: null, thread });
  assert.match(p, /Artifact state for this thread:/);
  assert.match(p, /model\.pkl is MISSING — produced by thread train:main/);
  assert.match(p, /never fabricate this file/);

  const bare = buildChatPrompt({ userText: "x", activeFile: null, projectFiles: [], node: null, thread: { ...thread, artifacts: undefined } });
  assert.ok(!bare.includes("Artifact state"), "no artifact block without notes");
});

test("M-SKILL.7: a stale-withheld skill is named as WITHHELD — never 'no ratified skill exists'", () => {
  const block = renderRoutedBlock([
    { entryPointId: "a:1", qualifiedName: "a:one", matchedOn: ["`one`"], skill: null, skillOmitted: "stale" },
  ]);
  assert.match(block, /withheld: the thread's code changed after ratification/);
  assert.match(block, /verify its claims against the current code/);
  assert.ok(!block.includes("no ratified skill exists"), "must not deny the skill's existence");
});

test("M-SKILL.2: the status-quo pin — no routed arg and empty routed are byte-identical to pre-routing output", () => {
  const args = { userText: "x", activeFile: "db.py", projectFiles: FILES, node: null, thread: null };
  const bare = buildChatPrompt(args);
  assert.equal(buildChatPrompt({ ...args, routed: [] }), bare);
  assert.equal(renderRoutedBlock([]), "");
  assert.equal(renderRoutedBlock(undefined), "");
  assert.ok(!bare.includes("Routed context"), "no routed block without matches");
});
