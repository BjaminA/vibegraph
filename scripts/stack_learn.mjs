#!/usr/bin/env node
// M-CMD.3 — stack_learn: how the taxonomy learns a tool it did not know.
//
// The loop: a tool no table knows is classified by the `classify` pass
// (agent-stated `describe` policy) or stated by a person; a person RATIFIES
// it by setting the constraint's `source` to "human"; this script reads the
// ratified classifications out of one or more projects' constraint stores
// and prints the TABLE LINES they would add to src/shared/stack_taxonomy.ts,
// beside what the table already says about each. A human merges them (or
// does not — a private SDK is right to stay a stated policy), and from the
// next release the tables know the tool, the stated policy becomes
// redundant, and stackConflicts says so if the two ever disagree.
//
// Never writes the taxonomy. Never reads a model. The judgement that a
// classification is right is the ratification; this only carries it.
//
//   node --experimental-strip-types --no-warnings scripts/stack_learn.mjs <root>... [--all-sources] [--json] [--write <file>]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyTool, ROLE_LABEL } from "../src/shared/stack_taxonomy.ts";
import { loadConstraints } from "../src/server/constraint_store.ts";

const TABLE_FOR = { jsts: "JSTS_TOOLS", python: "PYTHON_TOOLS", bash: "BASH_TOOLS", cpp: "CPP_TOOLS", rust: "RUST_TOOLS" };

/** The language a stated tool belongs to: the classify pass records it in
 *  the note (`language=jsts`); a hand-written policy has only its name, so
 *  the shape decides and says it was a guess. */
export function languageOf(c) {
  const m = /language=([a-z]+)/.exec(c.note ?? "");
  if (m && TABLE_FOR[m[1]]) return { language: m[1], guessed: false };
  const t = c.policy.tool;
  if (t.startsWith("@") || t.includes("-")) return { language: "jsts", guessed: true };
  if (t.includes("_") || t.includes(".")) return { language: "python", guessed: true };
  return { language: "jsts", guessed: true };
}

export function learn(roots, { allSources = false } = {}) {
  const items = [];
  for (const root of roots) {
    const abs = resolve(root);
    for (const c of loadConstraints(abs)) {
      if (c.kind !== "stack-policy" || !c.policy?.role || c.policy.role === "unknown") continue;
      const ratified = c.source === "human";
      if (!ratified && !allSources) { items.push({ root: abs, id: c.id, tool: c.policy.tool, role: c.policy.role, source: c.source, status: "provisional", text: c.text }); continue; }
      const { language, guessed } = languageOf(c);
      const table = classifyTool(language, c.policy.tool);
      const status = table.role === "unknown" ? "candidate" : table.role === c.policy.role ? "in-table" : "conflict";
      items.push({ root: abs, id: c.id, tool: c.policy.tool, role: c.policy.role, source: c.source, language, guessed, tableRole: table.role, status, text: c.text });
    }
  }
  return items;
}

export function formatLearn(items) {
  const lines = ["# stack_learn — what ratified classifications would add to src/shared/stack_taxonomy.ts (review before merging)"];
  const by = (s) => items.filter((i) => i.status === s);
  const cands = by("candidate");
  if (cands.length) {
    for (const lang of Object.keys(TABLE_FOR)) {
      const list = cands.filter((i) => i.language === lang);
      if (!list.length) continue;
      lines.push("", `## ${lang} → ${TABLE_FOR[lang]}`);
      for (const i of list) {
        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(i.tool) ? i.tool : JSON.stringify(i.tool);
        lines.push(`  ${key}: "${i.role}", // ${i.text.replace(/\s+/g, " ").slice(0, 140)}  [${i.id} · ${i.source} · ${i.root}${i.guessed ? " · language guessed from the name" : ""}]`);
      }
    }
    lines.push("", "A PRIVATE package (one only this organisation installs) may be right to stay a stated policy in its project rather than a table line everyone ships.");
  } else {
    lines.push("", "No ratified classification the table does not already carry.");
  }
  const inTable = by("in-table");
  if (inTable.length) {
    lines.push("", "## already in the table (the stated policy is now redundant; it may be deleted)");
    for (const i of inTable) lines.push(`  ${i.tool} → ${i.role} (${i.id} · ${i.root})`);
  }
  const conflicts = by("conflict");
  if (conflicts.length) {
    lines.push("", "## CONFLICTS — the table says one thing, a person another; decide, do not merge blindly");
    for (const i of conflicts) lines.push(`  ${i.tool}: table says ${i.tableRole} (${ROLE_LABEL[i.tableRole]}), ${i.id} says ${i.role} (${i.root})`);
  }
  const prov = by("provisional");
  if (prov.length) {
    lines.push("", `## provisional — ${prov.length} agent- or orchestrator-stated classification(s) not ratified, so not carried (pass --all-sources to list them as candidates anyway)`);
    for (const i of prov) lines.push(`  ${i.tool} → ${i.role} (${i.id} · ${i.source} · ${i.root})`);
  }
  return lines.join("\n") + "\n";
}

const isMain = process.argv[1] && /stack_learn\.mjs$/.test(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const roots = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--write");
  if (!roots.length) { process.stderr.write("usage: stack_learn.mjs <root>... [--all-sources] [--json] [--write <file>]\n"); process.exit(2); }
  const items = learn(roots, { allSources: args.includes("--all-sources") });
  const out = flag("--write");
  if (out) writeFileSync(resolve(out), JSON.stringify(items, null, 2) + "\n");
  process.stdout.write(args.includes("--json") ? JSON.stringify(items, null, 2) + "\n" : formatLearn(items));
}
