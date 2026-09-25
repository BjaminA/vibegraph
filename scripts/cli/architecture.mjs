// `vibegraph-knowledge architecture` — M-ARCH.4/.5 (PLAN-M-ARCH.md).
//
// Without a flag: zero tokens. Builds the architecture model from the code
// (plus `.vibegraph/architecture.json`, what a person stated) and writes the
// three files (scripts/arch_artifacts.mjs).
//
// --propose SPENDS TOKENS, once: the model is shown the derived model, the
// deployment facts (src/server/infra_manifests.ts, line by line) and the
// project's doc lines, and may propose groups / names / a primary path / a
// narrative. The reply is grounded by the same function the server uses
// (arch_propose.ts parseProposal): citations not shown are dropped, uncited
// items are INFERRED, invented nodes are refused. It is stored PENDING and
// drawn ghosted. --ratify / --reject decide it: whoever runs the command is
// the human, and the command says so in what it prints.
//
// The spawn is the classify spawn (classify.mjs spawnClassifier): no MCP, no
// write tools, `VG_CLAUDE_BIN` stubbable.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadEnvelope } from "../quality_check.mjs";
import { buildStackIndex } from "../../src/server/stack.ts";
import { buildCrossingIndex } from "../../src/server/crossings.ts";
import { archModelForEnvelope } from "../../src/server/arch_envelope.ts";
import { applyArchStore, loadArchStore, ratifyProposal, rejectProposal, saveArchStore } from "../../src/server/arch_store.ts";
import { buildProposePrompt, docExcerpts, parseProposal } from "../../src/server/arch_propose.ts";
import { readInfraManifests } from "../../src/server/infra_manifests.ts";
import { spawnClassifier } from "./classify.mjs";
import { repositoryFor, writeArchArtifacts } from "../arch_artifacts.mjs";
import { deriveThreadCalls } from "../../src/webview/system/threadInteraction.ts";

export function runArchitecture({ root, out, envelope, pipeline, commit, tool, action = null, replyFile, dryRun = false, model, guidance, archify = false, env = process.env }) {
  const absRoot = resolve(root);
  const lines = [];
  const messages = [];
  const { envelope: envl, parseErrors } = loadEnvelope(absRoot, envelope, pipeline ?? {});
  if (Object.keys(parseErrors ?? {}).length) messages.push(`parse errors (those files carry no IR): ${Object.keys(parseErrors).join(", ")}`);
  const stack = buildStackIndex(envl, absRoot);
  const crossings = buildCrossingIndex(envl);
  const derived = archModelForEnvelope(envl, stack, crossings, absRoot, undefined, { applyStore: false });
  let exitCode = 0;

  if (action === "propose") {
    const facts = readInfraManifests(absRoot).facts;
    const docs = docExcerpts(absRoot, derived);
    const pending = loadArchStore(absRoot).proposal;
    if (guidance && !pending) return { lines, messages: [...messages, "there is no pending proposal to modify"], exitCode: 1 };
    const prompt = buildProposePrompt(derived, facts, docs, guidance ? { previous: pending, guidance } : undefined);
    if (dryRun) {
      lines.push(prompt);
      return { lines, messages, exitCode: 0 };
    }
    let text;
    let label = "saved reply";
    if (replyFile) text = readFileSync(resolve(replyFile), "utf-8");
    else {
      messages.push(`asking a model (this spends tokens): ${facts.length} deployment facts, ${docs.length} doc lines, ${derived.nodes.length} boxes`);
      const r = spawnClassifier({ prompt, model, cwd: absRoot, env });
      if (!r.ok) return { lines, messages: [...messages, r.error], exitCode: 3 };
      text = r.text;
      label = r.model;
    }
    const parsed = parseProposal(text, derived, facts, docs, { model: label });
    if (!parsed.proposal) return { lines, messages: [...messages, parsed.error ?? "the reply was not a usable proposal"], exitCode: 3 };
    const store = loadArchStore(absRoot);
    store.proposal = parsed.proposal;
    saveArchStore(absRoot, store);
    const p = parsed.proposal;
    lines.push(`proposal from ${p.model}, PENDING in .vibegraph/architecture.json:`);
    for (const g of p.groups) lines.push(`  group ${g.id} (${g.kind}) "${g.label}" wraps ${g.wraps.join(", ")} — ${g.evidence.length ? `evidence ${g.evidence.join(", ")}` : "INFERRED, no evidence"}`);
    for (const [id, n] of Object.entries(p.names)) lines.push(`  name ${id} → "${n.label}" — ${n.evidence.length ? `evidence ${n.evidence.join(", ")}` : "INFERRED"}`);
    if (p.primaryPath) lines.push(`  start here: ${p.primaryPath.entryPoints.join(", ")}`);
    if (p.narrative) lines.push(`  ${p.narrative}`);
    for (const r of p.refused) lines.push(`  refused ${r.item}: ${r.reason}`);
    lines.push("decide it: --ratify makes it stated, --reject drops it");
  } else if (action === "ratify" || action === "reject") {
    const store = loadArchStore(absRoot);
    if (!store.proposal) {
      messages.push("there is no pending architecture proposal to decide");
      exitCode = 1;
    } else {
      saveArchStore(absRoot, action === "ratify" ? ratifyProposal(store) : rejectProposal(store));
      lines.push(action === "ratify"
        ? `ratified: the proposal from ${store.proposal.model} is now STATED in .vibegraph/architecture.json (by whoever ran this command)`
        : `rejected: the proposal from ${store.proposal.model} is dropped`);
    }
  }

  const arch = applyArchStore(derived, loadArchStore(absRoot));
  const outDir = resolve(out ?? join(absRoot, ".vibegraph", "architecture-map"));
  mkdirSync(outDir, { recursive: true });
  const written = writeArchArtifacts(arch, {
    write: (rel, text) => { const p = join(outDir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); },
    title: basename(absRoot), commit, tool, repository: repositoryFor(absRoot), archify,
    envelope: envl, threadGraph: deriveThreadCalls(envl.threads, envl.entryPoints, crossings),
  });
  lines.push(`wrote ${written.join(", ")} to ${outDir}: ${arch.nodes.length} boxes, ${arch.edges.length} edges, ${arch.groups.length} groups${arch.proposal ? " (a proposal is pending)" : ""}`);
  return { lines, messages, exitCode };
}
