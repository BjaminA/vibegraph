#!/usr/bin/env node
// Quality layer, Run 3: run one check against a real project and print
// the RAW CheckResult JSON. Described output is what the brief refuses;
// this is the other thing.
//
//   node --experimental-strip-types --no-warnings scripts/quality_check.mjs <root> \
//        --check '{"rule":"guards","target":"notify","guard":"should_notify"}' \
//        [--envelope <project.json>] [--thread <entryPointId> | --all-threads] \
//        [--files a.py,b.py | --all-files] [--git <revA>..<revB> | --git <rev>] [--commit <sha>]
//
// <root> is parsed through scripts/regen_polyglot.mjs's buildPolyglotEnvelope
// (the server's pipeline) unless --envelope names a committed project.json
// (fixtures with manual seeds keep their threads there). `--git` turns a
// commit range's file list into a run delta for co-changes (calibration
// over history). Exit 0 when the check ran; the verdict is in the JSON.
// Exit 2 on bad invocation.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, resolve } from "node:path";
import { buildPolyglotEnvelope } from "./regen_polyglot.mjs";
import { buildStackIndex } from "../src/server/stack.ts";
import { buildQualityFacts } from "../src/server/quality/facts.ts";
import { newRegistry } from "../src/server/quality/verbs/index.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function usage(msg) {
  if (msg) console.error(msg);
  console.error("usage: quality_check.mjs <root> --check '<json>' [--envelope <p>] [--thread <ep> | --all-threads] [--files a,b | --all-files] [--git <range>] [--commit <sha>]");
  process.exit(2);
}

/** A git range's file list as a run delta: one "packet" per commit. */
export function gitDelta(range, cwd = ROOT) {
  const revs = range.includes("..")
    ? execFileSync("git", ["rev-list", "--reverse", range], { cwd, encoding: "utf-8" }).trim().split("\n").filter(Boolean)
    : [range];
  const entries = [];
  for (const rev of revs) {
    const out = execFileSync("git", ["show", "--name-status", "--format=", rev], { cwd, encoding: "utf-8" });
    for (const line of out.split("\n")) {
      const m = /^([AMDR])\d*\t(.+?)(?:\t(.+))?$/.exec(line);
      if (!m) continue;
      const file = m[3] ?? m[2];
      const change = m[1] === "A" ? "added" : m[1] === "D" ? "removed" : "changed";
      entries.push({ packetId: rev.slice(0, 7), file, nodeId: null, change });
    }
  }
  return { entries, complete: true };
}

/**
 * Paths resolve from the CALLER's cwd (M-CRYSTAL.1 — they used to resolve
 * from this checkout, which a packaged CLI does not have; every repo caller
 * runs from the repo root through npm, so nothing moved for them).
 * `pipeline` is handed to buildPolyglotEnvelope: scriptsDir / pythonBin /
 * pythonEnv / cwd for a caller that is not this checkout.
 */
export function loadEnvelope(root, envelopePath, pipeline = {}) {
  const absRoot = resolve(root);
  if (envelopePath) {
    return { absRoot, envelope: JSON.parse(readFileSync(resolve(envelopePath), "utf-8")), parseErrors: {}, skippedDirs: {}, unresolvedSeeds: [] };
  }
  const built = buildPolyglotEnvelope(absRoot, pipeline);
  return {
    absRoot, envelope: built.envelope, parseErrors: built.parseErrors,
    skippedDirs: built.skippedDirs ?? {}, unresolvedSeeds: built.unresolvedSeeds ?? [],
  };
}

export function runCheck({ root, envelope: envelopePath, check, thread, allThreads, files, allFiles, git, commit }) {
  const { absRoot, envelope: env, parseErrors } = loadEnvelope(root, envelopePath);
  const stack = buildStackIndex(env, absRoot);
  const registry = newRegistry();
  // The delta comes from the repo being CHECKED, not from whatever repo this
  // script happens to live in. With `<root>` = this repo (calibration over
  // our own history, what --git was built for) the two are the same and
  // nothing moves; with any other root the old default silently read
  // VibeGraph's history against someone else's tree. Found when the
  // M-SKILLS.3 drills needed co-changes scored on an arm tree.
  const runDelta = git ? gitDelta(git, absRoot) : null;
  const scopeFiles = allFiles ? Object.keys(env.files) : files ? files.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const threads = allThreads
    ? env.threads.map((t) => t.entryPointId).filter(Boolean)
    : thread ? [thread] : [undefined];
  const results = [];
  for (const ep of threads) {
    const facts = buildQualityFacts({
      envelope: env, root: absRoot, commit, stack, runDelta,
      ...(ep ? { entryPointId: ep } : {}), ...(scopeFiles ? { scopeFiles } : {}),
    });
    const result = registry.run(facts, check);
    results.push({ thread: ep ?? null, result });
  }
  return { root, envelope: envelopePath ?? null, commit, check, scopeFiles: scopeFiles ?? null, parseErrors, results };
}

// Main guard by file name, not by import.meta.url === argv[1]: inside the
// M-CRYSTAL bundle both are the bundle, and this block would exit(2) at import.
if (process.argv[1] && basename(process.argv[1]) === "quality_check.mjs") {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--") && !args.includes(`--${a}`) && (args.indexOf(a) === 0 || !args[args.indexOf(a) - 1].startsWith("--")));
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (!root) usage("missing <root>");
  const checkRaw = flag("--check");
  if (!checkRaw) usage("missing --check");
  let check;
  try { check = JSON.parse(checkRaw); } catch (e) { usage(`--check is not JSON: ${e.message}`); }
  const commit = flag("--commit") ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).trim();
  const out = runCheck({
    root, envelope: flag("--envelope"), check, thread: flag("--thread"), allThreads: args.includes("--all-threads"),
    files: flag("--files"), allFiles: args.includes("--all-files"), git: flag("--git"), commit,
  });
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
