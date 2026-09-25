#!/usr/bin/env node
// Quality layer, Run 3: DERIVE the configs from a project. Nothing here is
// authored; every field is read from the envelope, the stack index, the
// constraint store or a skill file, or is Unknown with a reason. Each
// output is validated against its schema before it is written; an
// invalid instance is a bug in the deriver and exits 1.
//
//   node --experimental-strip-types --no-warnings scripts/quality_derive.mjs <root> \
//        [--envelope <project.json>] [--out <dir>] [--skills <dir>] [--commit <sha>]
//
// Writes <out>/stack_profile.json, <out>/quality_model.json and
// <out>/skills/<file>.manifest.json. Default --out is
// reviews/quality-layer/derived/<basename of root>, deliberately NOT
// .vibegraph/: the server does not read these until the wiring step
// after calibration (RUN3.md).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildStackIndex } from "../src/server/stack.ts";
import { loadConstraints } from "../src/server/constraint_store.ts";
import { deriveStackProfile } from "../src/server/quality/profile.ts";
import { deriveQualityModel } from "../src/server/quality/model.ts";
import { deriveSkillManifest } from "../src/server/quality/skill_manifest.ts";
import { loadEnvelope } from "./quality_check.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = "https://vibegraph.dev/schemas/quality/";

export function qualityAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  for (const f of readdirSync(join(ROOT, "schemas", "quality")).filter((x) => x.endsWith(".json"))) {
    ajv.addSchema(JSON.parse(readFileSync(join(ROOT, "schemas", "quality", f), "utf-8")));
  }
  return ajv;
}

export function deriveAll({ root, envelope: envelopePath, skillsDir, commit }) {
  const { absRoot, envelope, parseErrors } = loadEnvelope(root, envelopePath);
  const stack = buildStackIndex(envelope, absRoot);
  const constraints = existsSync(join(absRoot, ".vibegraph", "constraints.json")) ? loadConstraints(absRoot) : [];
  const notes = [];
  const profileOut = deriveStackProfile(envelope, stack, { project: root, commit });
  notes.push(...profileOut.notes.map((n) => `profile: ${n}`));
  const modelOut = deriveQualityModel(profileOut.profile, constraints, { commit });
  notes.push(...modelOut.notes.map((n) => `model: ${n}`));
  const skills = [];
  const dir = skillsDir ? resolve(ROOT, skillsDir) : join(absRoot, ".vibegraph", "thread-skills");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
      const r = deriveSkillManifest(readFileSync(join(dir, f), "utf-8"), constraints, { commit });
      notes.push(...r.notes.map((n) => `skill ${f}: ${n}`));
      if (r.manifest) skills.push({ file: f, manifest: r.manifest });
    }
  } else notes.push(`skills: no directory at ${dir}`);
  return { profile: profileOut.profile, model: modelOut.model, skills, constraints, parseErrors, notes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const root = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
  if (!root) { console.error("usage: quality_derive.mjs <root> [--envelope p] [--out dir] [--skills dir] [--commit sha]"); process.exit(2); }
  const commit = flag("--commit") ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).trim();
  const out = resolve(ROOT, flag("--out") ?? join("reviews", "quality-layer", "derived", basename(root)));
  const r = deriveAll({ root, envelope: flag("--envelope"), skillsDir: flag("--skills"), commit });
  const ajv = qualityAjv();
  const check = (schema, inst, label) => {
    const v = ajv.getSchema(BASE + schema);
    if (!v(inst)) { console.error(`${label}: NOT a valid ${schema}:\n  ${ajv.errorsText(v.errors, { separator: "\n  " })}`); process.exit(1); }
  };
  check("stack_profile.json", r.profile, "stack_profile");
  check("quality_model.json", r.model, "quality_model");
  for (const s of r.skills) check("skill_manifest.json", s.manifest, `skill ${s.file}`);
  mkdirSync(join(out, "skills"), { recursive: true });
  writeFileSync(join(out, "stack_profile.json"), JSON.stringify(r.profile, null, 2) + "\n");
  writeFileSync(join(out, "quality_model.json"), JSON.stringify(r.model, null, 2) + "\n");
  for (const s of r.skills) writeFileSync(join(out, "skills", s.file.replace(/\.md$/, ".manifest.json")), JSON.stringify(s.manifest, null, 2) + "\n");
  for (const n of r.notes) console.error(`note: ${n}`);
  console.log(JSON.stringify({
    out, commit,
    facts: Object.keys(r.profile.facts), regimes: r.profile.regimes.map((x) => x.id), threads: Object.keys(r.profile.threads).length,
    dimensions: r.model.dimensions.map((d) => ({ id: d.id, checks: d.checks.map((c) => c.check) })),
    skills: r.skills.map((s) => ({ file: s.file, rules: s.manifest.rules.length, omitted: s.manifest.omitted.length })),
    parseErrors: Object.keys(r.parseErrors).length,
  }, null, 2));
}
