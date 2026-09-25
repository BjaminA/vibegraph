/**
 * Model tiers — routing spawns by what they do.
 *
 * The saving is real money (per-spawn floor ~$0.25 on Opus vs ~$0.04 on
 * Haiku, measured), so the rules that decide which flags reach the CLI are
 * worth pinning: the whitelist at the WS boundary, the "match" opt-out, and
 * the fact that an unrouted caller stays on the CLI default rather than
 * being silently cheapened.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/model_tiers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIERS, DEFAULT_LOCAL, ROUTINE_EFFORT, sanitiseTiers, tierArgs, resolveTierRoute, routeLabel, tierClaudeModel,
} from "../src/shared/model_tiers.ts";
import { resolveClaudeBin, setModelTiers, serviceSuffix, spawnEnv } from "../src/server/run/synth_args.ts";

test("routine defaults to Sonnet, not Haiku — Haiku draft quality is untested", () => {
  assert.equal(DEFAULT_TIERS.routine, "claude-sonnet-5");
  assert.equal(DEFAULT_TIERS.thinking, null, "thinking defaults to the CLI's own model");
});

test("thinking tier passes --model only when one is chosen", () => {
  assert.deepEqual(tierArgs("thinking", { thinking: null, routine: "claude-sonnet-5" }), []);
  assert.deepEqual(
    tierArgs("thinking", { thinking: "claude-opus-5", routine: "claude-sonnet-5" }),
    ["--model", "claude-opus-5"],
  );
});

test("routine tier steps down the model AND trims effort", () => {
  const args = tierArgs("routine", { thinking: "claude-opus-5", routine: "claude-haiku-4-5" });
  assert.deepEqual(args, ["--model", "claude-haiku-4-5", "--effort", ROUTINE_EFFORT]);
});

test('"match above" is a real opt-out — no split, and no silent effort trim', () => {
  // A user who picks "match" asked for ONE model everywhere; quietly lowering
  // effort would be a split they did not ask for.
  assert.deepEqual(
    tierArgs("routine", { thinking: "claude-opus-5", routine: "match" }),
    ["--model", "claude-opus-5"],
  );
  // Match + CLI default = the pre-tier behaviour exactly: no flags at all.
  assert.deepEqual(tierArgs("routine", { thinking: null, routine: "match" }), []);
});

test("an arbitrary --model string from a WS client never reaches the CLI", () => {
  const evil = sanitiseTiers({ thinking: "$(rm -rf /)", routine: "../../etc/passwd" });
  assert.deepEqual(evil, DEFAULT_TIERS, "unknown ids fall back to defaults");
  // A model that exists but is not offered for that tier is also refused:
  // Haiku must not become the thinking tier by way of a hand-sent message.
  assert.equal(sanitiseTiers({ thinking: "claude-haiku-4-5" }).thinking, DEFAULT_TIERS.thinking);
  assert.deepEqual(sanitiseTiers(undefined), DEFAULT_TIERS);
  assert.deepEqual(sanitiseTiers(null), DEFAULT_TIERS);
});

test("resolveClaudeBin injects the tier flags as PREFIX args", () => {
  // They must precede `-p`: gen spawns end with `-- <prompt>`, so a trailing
  // flag would be swallowed as a positional.
  setModelTiers({ thinking: "claude-opus-5", routine: "claude-haiku-4-5" });
  try {
    assert.deepEqual(resolveClaudeBin("thinking").args, ["--model", "claude-opus-5"]);
    assert.deepEqual(
      resolveClaudeBin("routine").args,
      ["--model", "claude-haiku-4-5", "--effort", ROUTINE_EFFORT],
    );
    // No tier = unrouted caller = unchanged behaviour, never cheapened.
    assert.deepEqual(resolveClaudeBin().args, []);
  } finally {
    setModelTiers(DEFAULT_TIERS);
  }
});

test("VG_CLAUDE_BIN prefix args survive, with routing appended after them", () => {
  const prev = process.env.VG_CLAUDE_BIN;
  process.env.VG_CLAUDE_BIN = "node /path/to/stub.mjs";
  setModelTiers({ thinking: "claude-opus-5", routine: "claude-sonnet-5" });
  try {
    const { cmd, args } = resolveClaudeBin("thinking");
    assert.equal(cmd, "node");
    assert.deepEqual(args, ["/path/to/stub.mjs", "--model", "claude-opus-5"],
      "the stub path must stay first or the stub is never invoked");
  } finally {
    if (prev === undefined) delete process.env.VG_CLAUDE_BIN;
    else process.env.VG_CLAUDE_BIN = prev;
    setModelTiers(DEFAULT_TIERS);
  }
});

test("serviceSuffix names a redirected endpoint by HOST, and stays silent for Anthropic's own", () => {
  // ANTHROPIC_BASE_URL points the Claude CLI at anything speaking the
  // Anthropic Message Protocol — a gateway serving GLM, or any other
  // model. Silence there would repeat M-BOUNDARY.5's bug in a new
  // spelling: an audit field naming a model that did not do the work.
  assert.equal(serviceSuffix(undefined), "", "unset is Anthropic - nothing to say");
  assert.equal(serviceSuffix(""), "");
  assert.equal(serviceSuffix("   "), "", "whitespace is unset, not a service");
  assert.equal(serviceSuffix("https://api.anthropic.com"), "", "that IS Anthropic");
  assert.equal(serviceSuffix("https://API.Anthropic.com/v1"), "", "case-insensitive");
  assert.equal(serviceSuffix("https://gw.anthropic.com/v1"), "", "a subdomain is still Anthropic");
  assert.equal(serviceSuffix("https://api.z.ai/api/anthropic"), "@api.z.ai");
  assert.equal(serviceSuffix("http://localhost:8080/v1"), "@localhost:8080", "the port distinguishes two local gateways");
  // The suffix is written to .vibegraph/work-run.json and quoted into
  // reports, so it carries the HOST and never the URL: a base URL can hold
  // a token in its path or query, and a label is not a place to leak one.
  assert.equal(serviceSuffix("https://gw.example.com/v1/sk-secret-token"), "@gw.example.com");
  assert.equal(serviceSuffix("https://user:pw@gw.example.com/v1"), "@gw.example.com", "credentials in the URL are dropped with the rest");
  // Unparseable says "not Anthropic" without echoing a string of unknown shape.
  assert.equal(serviceSuffix("not a url"), "@custom");
  // A fake tld must NOT pass as Anthropic's.
  assert.equal(serviceSuffix("https://anthropic.com.evil.test/v1"), "@anthropic.com.evil.test");
});

test("the audit label names the SERVICE when the CLI is redirected off Anthropic", () => {
  // The provider stays "claude" - it is the claude CLI on the claude code
  // path - but "who did the work" is a different question from "what ran
  // it", and the label answers the first.
  const prevUrl = process.env.ANTHROPIC_BASE_URL;
  const prevModel = process.env.ANTHROPIC_MODEL;
  const prevBin = process.env.VG_CLAUDE_BIN;
  delete process.env.VG_CLAUDE_BIN;
  process.env.ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic";
  try {
    process.env.ANTHROPIC_MODEL = "glm-5.3";
    setModelTiers(sanitiseTiers({}));
    assert.equal(resolveClaudeBin("thinking").label, "claude:glm-5.3@api.z.ai",
      "the tier pins nothing, so the CLI's own default-model env var names what served");
    assert.equal(resolveClaudeBin("worker").label, "claude:glm-5.3@api.z.ai");
    assert.equal(resolveClaudeBin("routine").label, "claude:claude-sonnet-5@api.z.ai",
      "a tier's own model still wins the MODEL half - a gateway may serve it under that name, and the suffix says where");
    delete process.env.ANTHROPIC_MODEL;
    assert.equal(resolveClaudeBin("thinking").label, "claude:default@api.z.ai",
      "unknown model, KNOWN service - naming half a truth beats naming none");
    // The provider is unchanged: routing, timeouts and every call site
    // still treat this as the claude path.
    assert.equal(resolveClaudeBin("thinking").provider, "claude");
  } finally {
    if (prevUrl === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = prevUrl;
    if (prevModel === undefined) delete process.env.ANTHROPIC_MODEL; else process.env.ANTHROPIC_MODEL = prevModel;
    if (prevBin !== undefined) process.env.VG_CLAUDE_BIN = prevBin;
    setModelTiers(DEFAULT_TIERS);
  }
});

// ── M-PROVIDER (2026-09-08) — the worker tier, providers per tier, the local endpoint ──

test("M-PROVIDER: the worker tier follows thinking by default and never trims effort", () => {
  assert.equal(DEFAULT_TIERS.worker, "match");
  assert.deepEqual(tierArgs("worker", { thinking: "claude-opus-5", routine: "claude-sonnet-5", worker: "match" }), ["--model", "claude-opus-5"]);
  assert.deepEqual(tierArgs("worker", { thinking: null, routine: "claude-sonnet-5", worker: "match" }), [], "match + CLI default = no flags");
  assert.deepEqual(tierArgs("worker", { thinking: "claude-opus-5", routine: "claude-sonnet-5", worker: "claude-haiku-4-5" }), ["--model", "claude-haiku-4-5"], "workers write code: no --effort trim");
  assert.equal(tierClaudeModel("worker", { thinking: "claude-opus-5", routine: "match" }), "claude-opus-5", "absent worker = match");
});

test("M-PROVIDER: sanitiseTiers validates providers, endpoints, model names, and commands at the boundary", () => {
  const legacy = sanitiseTiers({ thinking: "claude-opus-5", routine: "claude-sonnet-5" });
  assert.equal(legacy.worker, "match");
  assert.deepEqual(legacy.local, DEFAULT_LOCAL);
  assert.deepEqual(legacy.routes, {}, "a pre-M-PROVIDER shape is claude everywhere");
  const v = sanitiseTiers({
    thinking: null, routine: "match", worker: "claude-sonnet-5",
    local: { endpoint: "http://localhost:11434/", model: "qwen2.5-coder:7b" },
    routes: {
      worker: { provider: "ollama", endpoint: "http://10.0.0.5:11434", model: "qwen3:8b" },
      routine: { provider: "ollama", endpoint: "ftp://nope", model: "bad name!" },
      thinking: { provider: "command", command: "node /shim.mjs --x" },
      bogus: { provider: "ollama" },
    },
  });
  assert.equal(v.local.endpoint, "http://localhost:11434", "trailing slash normalised");
  assert.deepEqual(v.routes.worker, { provider: "ollama", endpoint: "http://10.0.0.5:11434", model: "qwen3:8b" });
  assert.deepEqual(v.routes.routine, { provider: "ollama" }, "bad endpoint/model dropped — falls back to the local defaults, never half-applied");
  assert.deepEqual(v.routes.thinking, { provider: "command", command: "node /shim.mjs --x" });
  assert.equal(v.routes.bogus, undefined, "unknown tiers dropped");
  const evil = sanitiseTiers({
    local: { endpoint: "http://user:pw@localhost:11434", model: "../x" },
    routes: { worker: { provider: "command", command: "rm -rf /\nreboot" }, thinking: { provider: "claude" } },
  });
  assert.deepEqual(evil.local, DEFAULT_LOCAL, "credentials in the URL and a path-shaped model name are refused");
  assert.deepEqual(evil.routes, {}, "a multi-line command is refused; an explicit claude route stores nothing");
});

test("M-PROVIDER: resolveTierRoute falls back to the local defaults and routeLabel says who did the work", () => {
  const s = sanitiseTiers({ thinking: "claude-opus-5", routine: "claude-sonnet-5", worker: "match", local: { endpoint: "http://localhost:11434", model: "qwen2.5-coder:7b" }, routes: { worker: { provider: "ollama" } } });
  assert.deepEqual(resolveTierRoute("worker", s), { provider: "ollama", endpoint: "http://localhost:11434", model: "qwen2.5-coder:7b" });
  assert.equal(routeLabel(resolveTierRoute("worker", s)), "ollama:qwen2.5-coder:7b@http://localhost:11434");
  assert.deepEqual(resolveTierRoute("thinking", s), { provider: "claude", model: "claude-opus-5", args: ["--model", "claude-opus-5"] });
  assert.equal(routeLabel(resolveTierRoute("thinking", s)), "claude:claude-opus-5");
  assert.equal(routeLabel(resolveTierRoute("thinking", sanitiseTiers({}))), "claude:default");
  assert.equal(routeLabel(resolveTierRoute("routine", sanitiseTiers({ routes: { routine: { provider: "command", command: "/opt/shim --a" } } }))), "command:/opt/shim");
});

test("M-PROVIDER: the audit label honours a --model pinned through VG_CLAUDE_BIN when the tier pins none", () => {
  const prev = process.env.VG_CLAUDE_BIN;
  process.env.VG_CLAUDE_BIN = "claude --model claude-opus-5";
  setModelTiers(DEFAULT_TIERS);
  try {
    assert.equal(resolveClaudeBin("thinking").label, "claude:claude-opus-5", "the pinned model is what runs");
    assert.equal(resolveClaudeBin("worker").label, "claude:claude-opus-5");
    setModelTiers({ ...DEFAULT_TIERS, thinking: "claude-fable-5" });
    assert.equal(resolveClaudeBin("thinking").label, "claude:claude-fable-5", "a tier's own model wins over the bin's");
  } finally {
    if (prev === undefined) delete process.env.VG_CLAUDE_BIN; else process.env.VG_CLAUDE_BIN = prev;
    setModelTiers(DEFAULT_TIERS);
  }
});

test("M-BOUNDARY.5: EVERY tier's audit label honours a model pinned through VG_CLAUDE_BIN", () => {
  // Found by the M-BOUNDARY drill: it ran `claude --model claude-opus-5`
  // and the run file recorded orchestration.model / review.model /
  // packet.workerModel as "claude:default". The M-STACK close-out had
  // fixed resolveClaudeBin's label and left server.ts's tierLabel on
  // routeLabel alone, which never sees the env. tierLabel delegates to
  // resolveClaudeBin now, so there is ONE label path; this pins what that
  // path must say for all three tiers the audit fields use.
  const prev = process.env.VG_CLAUDE_BIN;
  process.env.VG_CLAUDE_BIN = "claude --model claude-opus-5";
  setModelTiers(sanitiseTiers({}));
  try {
    // The rule: a tier's OWN model wins; the env pin fills in only where
    // the tier says "whatever the CLI defaults to" (thinking by default,
    // and worker, which matches thinking).
    assert.equal(resolveClaudeBin("thinking").label, "claude:claude-opus-5",
      "the tier pins nothing, so the pinned model is what actually ran");
    assert.equal(resolveClaudeBin("worker").label, "claude:claude-opus-5",
      "worker matches thinking");
    assert.equal(resolveClaudeBin("routine").label, "claude:claude-sonnet-5",
      "routine pins its own model - the env prefix does not override it");
    setModelTiers(sanitiseTiers({ thinking: "claude-opus-5", routine: "claude-haiku-4-5" }));
    assert.equal(resolveClaudeBin("routine").label, "claude:claude-haiku-4-5");
    // routeLabel alone stays pure over settings - that is why it drifted,
    // and why it is no longer the label the audit trail reads.
    assert.equal(routeLabel(resolveTierRoute("thinking", sanitiseTiers({}))), "claude:default");
  } finally {
    if (prev === undefined) delete process.env.VG_CLAUDE_BIN;
    else process.env.VG_CLAUDE_BIN = prev;
    setModelTiers(DEFAULT_TIERS);
  }
});


// ── M-GATEWAY — a "claude" route that names an endpoint ───────────────────
// Ben: "it should be a modular change in the code - so can change back to
// anthropic whenever required". A shell wrapper exporting ANTHROPIC_BASE_URL
// around the whole server cannot do that, and cannot route ONE tier. This is
// the same per-tier seam M-PROVIDER built for ollama, reusing TierRoute's
// existing endpoint/model fields rather than adding a fourth ProviderKind:
// the binary, the spawn and the MCP tool channel are all unchanged, because
// `--mcp-config` carries tools and is independent of who answers inference.

test("M-GATEWAY: the boundary stores a claude route's endpoint, and rejects a bad one", () => {
  const gw = "https://api.z.ai/api/anthropic";
  const s = sanitiseTiers({ routes: { worker: { provider: "claude", endpoint: gw, model: "glm-5.3" } } });
  assert.deepEqual(s.routes.worker, { provider: "claude", endpoint: gw, model: "glm-5.3" });

  // A trailing slash normalises, so two spellings of one gateway are one route.
  assert.equal(sanitiseTiers({ routes: { worker: { provider: "claude", endpoint: gw + "/" } } }).routes.worker.endpoint, gw);

  // The endpoint goes through the SAME validator ollama's does: no credentials
  // in the URL, no query, no fragment, http(s) only. A base URL carrying a
  // token would otherwise be persisted to .vibegraph/models.json on disk.
  for (const bad of ["ftp://x/y", "https://u:p@h/v1", "https://h/v1?k=secret", "https://h/v1#f", "not a url", ""]) {
    assert.equal(sanitiseTiers({ routes: { worker: { provider: "claude", endpoint: bad } } }).routes.worker, undefined,
      `endpoint ${JSON.stringify(bad)} must not be stored`);
  }
  // A model name is optional — the gateway's default then serves.
  assert.deepEqual(sanitiseTiers({ routes: { worker: { provider: "claude", endpoint: gw } } }).routes.worker,
    { provider: "claude", endpoint: gw });
});

test("M-GATEWAY: a gateway route never sends a Claude model name, and drops --effort", () => {
  const gw = "https://api.z.ai/api/anthropic";
  // routine pins claude-sonnet-5 + --effort low by default. Sending THAT to a
  // service serving GLM would assert a name mapping that is the gateway's to
  // claim, not ours — so the route's own model is the only model named.
  const s = sanitiseTiers({ routine: "claude-sonnet-5", routes: { routine: { provider: "claude", endpoint: gw, model: "glm-5.3" } } });
  const r = resolveTierRoute("routine", s);
  assert.deepEqual(r, { provider: "claude", endpoint: gw, model: "glm-5.3", args: ["--model", "glm-5.3"] });
  assert.ok(!r.args.includes("--effort"), "--effort is a Claude flag; a gateway need not understand it");
  assert.ok(!r.args.includes("claude-sonnet-5"), "the tier's Claude model must not reach the gateway");

  // With no model on the route, nothing is pinned at all and the endpoint decides.
  const s2 = sanitiseTiers({ routine: "claude-sonnet-5", routes: { routine: { provider: "claude", endpoint: gw } } });
  assert.deepEqual(resolveTierRoute("routine", s2).args, []);
  assert.equal(routeLabel(resolveTierRoute("routine", s2)), "claude:default@api.z.ai");
  assert.equal(routeLabel(resolveTierRoute("routine", s)), "claude:glm-5.3@api.z.ai");
});

test("M-GATEWAY: the spawn carries the route's endpoint, its key, and NOT the other service's", () => {
  const gw = "https://api.z.ai/api/anthropic";
  const prev = { key: process.env.VG_LLM_KEY, tok: process.env.ANTHROPIC_AUTH_TOKEN, api: process.env.ANTHROPIC_API_KEY, bin: process.env.VG_CLAUDE_BIN };
  delete process.env.VG_CLAUDE_BIN;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  process.env.VG_LLM_KEY = "zai-key-abc";
  process.env.ANTHROPIC_API_KEY = "sk-ant-fake"; // not a key: short enough that no secret scanner matches it
  try {
    setModelTiers(sanitiseTiers({ routes: { worker: { provider: "claude", endpoint: gw, model: "glm-5.3" } } }));
    const t = resolveClaudeBin("worker");
    assert.equal(t.provider, "claude", "still the claude provider: same binary, same spawn, same MCP channel");
    assert.equal(t.cmd, "claude");
    assert.equal(t.label, "claude:glm-5.3@api.z.ai");
    assert.deepEqual(t.env, { ANTHROPIC_BASE_URL: gw, ANTHROPIC_MODEL: "glm-5.3", ANTHROPIC_AUTH_TOKEN: "zai-key-abc" });

    const env = spawnEnv(t);
    assert.equal(env.ANTHROPIC_BASE_URL, gw);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, "zai-key-abc");
    // The Anthropic login is the WRONG SERVICE'S credential for this spawn,
    // and leaving it beside the gateway's makes which one is in play
    // ambiguous. It must be DELETED, not blanked.
    assert.ok(!("ANTHROPIC_API_KEY" in env), "a wrong-service credential must not reach the child");
    assert.equal(env.PATH, process.env.PATH, "the rest of the parent environment is untouched");

    // The key is never persisted: it comes from the environment, and the
    // route on disk holds routing only.
    const stored = JSON.stringify(sanitiseTiers({ routes: { worker: { provider: "claude", endpoint: gw, model: "glm-5.3" } } }));
    assert.ok(!stored.includes("zai-key-abc"), "models.json must never carry the credential");
  } finally {
    for (const [k, v] of [["VG_LLM_KEY", prev.key], ["ANTHROPIC_AUTH_TOKEN", prev.tok], ["ANTHROPIC_API_KEY", prev.api], ["VG_CLAUDE_BIN", prev.bin]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    setModelTiers(DEFAULT_TIERS);
  }
});

test("M-GATEWAY: routing is PER TIER, and removing the endpoint IS switching back", () => {
  const gw = "https://api.z.ai/api/anthropic";
  const prev = process.env.VG_CLAUDE_BIN;
  delete process.env.VG_CLAUDE_BIN;
  try {
    // Workers on GLM while thinking and routine stay on Claude — the thing a
    // wrapper around the whole server cannot express.
    setModelTiers(sanitiseTiers({
      thinking: "claude-opus-5", routine: "claude-haiku-4-5",
      routes: { worker: { provider: "claude", endpoint: gw, model: "glm-5.3" } },
    }));
    assert.equal(resolveClaudeBin("worker").label, "claude:glm-5.3@api.z.ai");
    assert.equal(resolveClaudeBin("thinking").label, "claude:claude-opus-5", "untouched tiers keep Anthropic");
    assert.equal(resolveClaudeBin("routine").label, "claude:claude-haiku-4-5");
    assert.equal(resolveClaudeBin("thinking").env, undefined, "a non-gateway spawn gets no env override at all");

    // Switching back is removing the route, and it must land EXACTLY where an
    // untouched install is — not approximately.
    const pinned = { thinking: "claude-opus-5", routine: "claude-haiku-4-5" };
    const before = resolveClaudeBin.bind(null);
    setModelTiers(sanitiseTiers({ ...pinned, routes: {} }));
    const plain = ["thinking", "routine", "worker"].map((t) => JSON.stringify(before(t)));
    setModelTiers(sanitiseTiers({ ...pinned, routes: { worker: { provider: "claude", endpoint: gw, model: "glm-5.3" } } }));
    setModelTiers(sanitiseTiers({ ...pinned, routes: { worker: { provider: "claude" } } }));
    const back = ["thinking", "routine", "worker"].map((t) => JSON.stringify(before(t)));
    assert.deepEqual(back, plain, "a claude route with no endpoint stores nothing, so the tier is byte-identical to never having been routed");
  } finally {
    if (prev === undefined) delete process.env.VG_CLAUDE_BIN; else process.env.VG_CLAUDE_BIN = prev;
    setModelTiers(DEFAULT_TIERS);
  }
});
