#!/usr/bin/env node
// M-SKILLS.1 — validate every generic skill under skills/ and write its
// manifest. Owned by PLAN-M-SKILLS.md (bump the plan's record if this
// script's behaviour changes, so doc and tool stay in lockstep).
//
//   node --experimental-strip-types --no-warnings scripts/skills_validate.mjs [--write] [--profile <stack_profile.json>]
//
// What it checks, all of it refused rather than defaulted:
//   1. the file parses under the ONE parser (src/server/generic_skills.ts):
//      frontmatter, five sections in order, every rule with a why AND a
//      binding, a non-empty limits list, a non-empty refusal ledger, binds
//      consistent with the rules, body under the ceiling;
//   2. the derived manifest validates against
//      schemas/quality/generic_skill.json under strict Ajv 2020 with its
//      sibling schemas loaded;
//   3. applies_when is MEASURED against a stack profile (default: the
//      fleet-telemetry one Run 3 derived): the skill must fire on at least
//      one thread, and its breadth is printed. Breadth is NOT an error: a
//      thread inherits every project-level fact it does not carry
//      (predicate.ts), so a skill keyed to `testsPresent` legitimately
//      fires on every thread of a tested project — that is a regime, not
//      an `always`. The `always` floor is that the predicate names a fact
//      at all, which the parser enforces. The retry skill is measured
//      with the retry task fact on, since no profile carries task facts.
//
// --write refreshes reviews/skills/derived/<name>.manifest.json; without
// it the script compares and reports drift. Exit 1 on any problem.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadGenericSkills } from "../src/server/generic_skills.ts";
import { evaluatePredicate } from "../src/server/quality/predicate.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");
const SCHEMA_DIR = join(ROOT, "schemas", "quality");
const OUT_DIR = join(ROOT, "reviews", "skills", "derived");
const BASE = "https://vibegraph.dev/schemas/quality/";

const args = process.argv.slice(2);
const write = args.includes("--write");
const profilePath = args.includes("--profile")
  ? resolve(args[args.indexOf("--profile") + 1])
  : join(ROOT, "reviews", "quality-layer", "derived", "fleet-telemetry", "stack_profile.json");

function commitOf() {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).trim(); } catch { return "unversioned"; }
}

/** The manifest is the skill minus its body, plus provenance. */
export function manifestOf(skill, commit) {
  return {
    version: "1.0",
    name: skill.name,
    description: skill.description,
    skillVersion: skill.skillVersion,
    lastUpdated: skill.lastUpdated,
    dimension: skill.dimension,
    applies_when: skill.applies_when,
    binds: skill.binds,
    derivedFrom: skill.derivedFrom,
    evidence: skill.evidence,
    ...(skill.drill ? { drill: skill.drill } : {}),
    rules: skill.rules,
    limits: skill.limits,
    refused: skill.refused,
    provenance: { kind: "derived", by: "scripts/skills_validate.mjs", commit, at: new Date().toISOString() },
  };
}

/** Measure applies_when on every thread of a profile. Returns the thread
 *  ids it fires on. The retry skill is measured with task.retry on. */
export function measureAppliesWhen(skill, profile) {
  const task = skill.dimension === "retry" ? { retry: true } : undefined;
  const fired = [];
  for (const entryPointId of Object.keys(profile.threads ?? {})) {
    if (evaluatePredicate(skill.applies_when, { profile, entryPointId, task })) fired.push(entryPointId);
  }
  return fired;
}

function main() {
  const problems = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  for (const f of readdirSync(SCHEMA_DIR).filter((x) => x.endsWith(".json"))) ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, f), "utf-8")));
  const validate = ajv.getSchema(BASE + "generic_skill.json");
  if (!validate) { console.error("generic_skill.json did not compile"); process.exit(1); }

  const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
  const threadCount = Object.keys(profile.threads ?? {}).length;
  const { skills, problems: parseProblems } = loadGenericSkills(SKILLS_DIR);
  for (const [name, ps] of Object.entries(parseProblems)) for (const p of ps) problems.push(`${name}: ${p}`);

  const commit = commitOf();
  const rows = [];
  for (const s of skills) {
    const m = manifestOf(s, commit);
    if (!validate(m)) for (const e of validate.errors ?? []) problems.push(`${s.name}: schema ${e.instancePath || "/"} ${e.message}`);
    const fired = measureAppliesWhen(s, profile);
    if (!fired.length) problems.push(`${s.name}: applies_when fires on NO thread of ${profilePath} — a skill that never applies is not a skill`);
    rows.push({ name: s.name, rules: s.rules.length, judgement: s.rules.filter((r) => r.binding === "judgement").length, fires: `${fired.length}/${threadCount}`, body: s.body.length });

    const out = join(OUT_DIR, `${s.name}.manifest.json`);
    const text = JSON.stringify(m, null, 2) + "\n";
    if (write) { mkdirSync(OUT_DIR, { recursive: true }); writeFileSync(out, text); }
    else if (existsSync(out)) {
      const prev = JSON.parse(readFileSync(out, "utf-8"));
      const strip = (x) => JSON.stringify({ ...x, provenance: undefined });
      if (strip(prev) !== strip(m)) problems.push(`${s.name}: manifest drifted from ${out} (run with --write after reviewing the change)`);
    } else problems.push(`${s.name}: no derived manifest at ${out} (run with --write)`);
  }

  console.log(`generic skills: ${skills.length} parsed from ${SKILLS_DIR}; profile ${profilePath} (${threadCount} threads)`);
  for (const r of rows) console.log(`  ${r.name.padEnd(20)} rules=${r.rules} (judgement ${r.judgement})  fires ${r.fires}  body ${r.body} chars`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(write ? `\nmanifests written to ${OUT_DIR}` : "\nmanifests match the derived ones");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
