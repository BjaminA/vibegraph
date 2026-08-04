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
  DEFAULT_TIERS, ROUTINE_EFFORT, sanitiseTiers, tierArgs,
} from "../src/shared/model_tiers.ts";
import { resolveClaudeBin, setModelTiers } from "../src/server/run/synth_args.ts";

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
