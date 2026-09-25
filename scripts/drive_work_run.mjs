#!/usr/bin/env node
// M-ORCH — headless driver for a work run against a RUNNING VibeGraph
// server (the same WS messages the Agent Manager board sends). Made for
// the real-claude drill: boot `node dist/server.js <project>` with PORT,
// then run this with a task. It prints the orchestrator's brief, sends
// ONE confirmation (the objective gate — the human's click, here yours by
// running this script), streams every packet transition and verdict, and
// prints the honest summary. It never approves a packet itself: an
// escalation or a packet left at the human gate stops the drive and says
// why — those are yours to resolve in the board.
//
//   node scripts/drive_work_run.mjs --port 4299 --mode orchestrated --task "…"
//   options: --gated (mode gated; the script then STOPS at the first
//            evidence gate — it will not click Approve for you),
//            --timeout <s> (default 900), --out <file> (run JSON dump)
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const port = Number(opt("port", process.env.PORT ?? "4200"));
const mode = args.includes("--gated") ? "gated" : (opt("mode", "orchestrated"));
const task = opt("task", null);
const timeoutS = Number(opt("timeout", "900"));
const out = opt("out", null);
// M-ORCH.4 — --parallel N (lanes; server default 3 orchestrated / 1 gated),
// --review full|pre-checks (server default pre-checks in orchestrated mode).
const parallel = opt("parallel", null) ? Number(opt("parallel", null)) : undefined;
const review = opt("review", null) ?? undefined;
// AUTONOMY — the server confirms the objective itself; this script never sends work-run-ratify.
const autonomous = args.includes("--autonomous");
if (!task) { console.error("--task is required"); process.exit(2); }

const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const send = (type, payload = {}) => ws.send(JSON.stringify({ type, payload }));

let phase = "connect";
let lastSig = "";
let ratified = false;
let run = null;
const seenReviews = new Set();

function describe(r) {
  const packets = r.packets.map((p) => `${p.id}:${p.status}${p.attempts > 1 ? `#${p.attempts}` : ""}`).join(" ");
  const inFlight = r.packets.filter((p) => p.status === "running").length;
  return `run ${r.status} · lanes ×${r.parallel ?? 1}${inFlight > 1 ? ` (${inFlight} running)` : ""} · ${packets}`;
}

function finish(code, why) {
  console.log(`${stamp()} ${why}`);
  if (run && out) writeFileSync(out, JSON.stringify(run, null, 2));
  ws.close();
  setTimeout(() => process.exit(code), 100);
}

ws.on("open", () => {
  console.log(`${stamp()} connected to :${port} — waiting for the envelope`);
});

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg.type === "work-run-error") {
    console.error(`${stamp()} SERVER ERROR: ${msg.payload?.error}`);
    if (phase === "connect" || phase === "start") finish(1, "could not start the run");
    return;
  }
  if (msg.type !== "project-update") return;
  const env = msg.payload;

  if (phase === "connect") {
    const existing = env.workRun;
    if (existing && !["done", "failed"].includes(existing.status)) {
      finish(1, `a run is already ${existing.status} — discard it in the board first`);
      return;
    }
    console.log(`${stamp()} envelope: ${env.entryPoints?.length ?? 0} entry points, ${env.threads?.length ?? 0} threads, ${(env.constraints ?? []).length} stated constraint(s)`);
    phase = "start";
    console.log(`${stamp()} starting ${mode} run${parallel ? ` (lanes ×${parallel})` : ""}${review ? ` (review: ${review})` : ""}: ${task}`);
    send("work-run-start", { task, mode, ...(parallel ? { parallel } : {}), ...(review ? { review } : {}), ...(autonomous ? { autonomous: true } : {}) });
    return;
  }

  run = env.workRun ?? null;
  if (!run) return;
  const sig = JSON.stringify([run.status, run.orchestration?.status, run.packets.map((p) => [p.id, p.status, p.attempts, p.review?.verdict])]);
  if (sig === lastSig) return;
  lastSig = sig;

  if (run.status === "draft") {
    if (phase === "start") {
      phase = "draft";
      console.log(`${stamp()} DRAFT: ${run.packets.length} packet(s): ${run.packets.map((p) => `${p.id}=${p.plan.qualifiedName}`).join(", ")}`);
      if (run.unmatchedTokens.length) console.log(`${stamp()}   NOT covered: ${run.unmatchedTokens.join(", ")}`);
      for (const p of run.packets) {
        const c = p.plan.contract;
        console.log(`${stamp()}   ${p.id} files=${p.plan.filesReached.join(",")} deps=${p.plan.boundaries.dependsOn.join(",") || "-"}`
          + (c ? ` contract{params=${c.params} returns=${c.returns ?? "-"} effects=${JSON.stringify(c.effects)} roundTrips=${c.roundTrips} constraints=${c.constraints}}` : ""));
      }
    }
    const o = run.orchestration;
    if (mode === "orchestrated") {
      if (!o || o.status === "drafting") { console.log(`${stamp()} brief: drafting…`); return; }
      if (!ratified) {
        console.log(`${stamp()} BRIEF ${o.status}: ${o.note}`);
        if (o.status === "ready") {
          console.log(`${stamp()}   OBJECTIVE: ${o.objective}`);
          for (const [id, t] of Object.entries(o.packetTasks)) {
            console.log(`${stamp()}   ${id} TASK: ${t.task}`);
            for (const h of t.handoff) console.log(`${stamp()}        handoff: ${h}`);
          }
          for (const g of o.globalConstraints) console.log(`${stamp()}   GLOBAL [${g.kind}] ${g.text} scope=${JSON.stringify(g.scope)}`);
          for (const x of o.extraPackets ?? []) {
            console.log(`${stamp()}   SYSTEM PACKET ${x.id} "${x.title}" files=${x.files.join(",")} integrates=${x.integrates.join(",") || "-"} after=${x.after.join(",") || "-"}`);
            console.log(`${stamp()}        rationale: ${x.rationale}`);
            console.log(`${stamp()}        task: ${x.task}`);
            for (const h of x.handoff) console.log(`${stamp()}        handoff: ${h}`);
          }
          if (!(o.extraPackets ?? []).length) console.log(`${stamp()}   (no system packets proposed)`);
          // M-STACK.4 — tools the brief proposes (confirmed into policies at the gate).
          for (const sp of o.stackProposals ?? []) {
            console.log(`${stamp()}   STACK PROPOSAL ${sp.rule} ${sp.tool}${sp.role ? ` [${sp.role}]` : ""} scope=${JSON.stringify(sp.scope)}`);
            console.log(`${stamp()}        why: ${sp.why}`);
            for (const a of sp.alternatives ?? []) console.log(`${stamp()}        not ${a.tool}: ${a.whyNot}`);
          }
          if (!(o.stackProposals ?? []).length) console.log(`${stamp()}   (no stack proposals)`);
        }
        ratified = true;
        if (autonomous) { console.log(`${stamp()} autonomous: the server confirms the objective itself (${run.autonomy?.ruling ?? "ruling"})`); return; }
        console.log(`${stamp()} >>> confirming the objective (the one human gate)`);
        send("work-run-ratify");
      }
      return;
    }
    if (!ratified) {
      ratified = true;
      console.log(`${stamp()} >>> ratifying the plan (gated mode: this script will NOT approve packets)`);
      send("work-run-ratify");
    }
    return;
  }

  console.log(`${stamp()} ${describe(run)}`);
  for (const p of run.packets) {
    if (p.review && !seenReviews.has(`${p.id}#${p.attempts}`)) {
      seenReviews.add(`${p.id}#${p.attempts}`);
      console.log(`${stamp()}   ${p.id} REVIEW by ${p.review.by}: ${p.review.verdict} — ${p.review.reason}`);
    }
    if (p.status === "escalated" && p.escalation) {
      console.log(`${stamp()}   ${p.id} ESCALATED: ${p.escalation.reason}`);
    }
    if (p.status === "awaiting-review" && mode === "gated") {
      finish(3, `${p.id} is at the human evidence gate — approve/reject in the board`);
      return;
    }
  }
  if (run.status === "done" || run.status === "failed") {
    console.log(`${stamp()} SUMMARY: ${run.summary?.note ?? "(none)"}`);
    if (run.summary?.filesChanged?.length) console.log(`${stamp()}   files changed: ${run.summary.filesChanged.join(", ")}`);
    for (const p of run.packets) {
      console.log(`${stamp()}   ${p.id} ${p.plan.qualifiedName}: ${p.status}; self-report: ${(p.evidence?.summary ?? "(none)").slice(0, 200)}`);
      for (const d of p.evidence?.diffs ?? []) console.log(`${stamp()}     diff ${d.file}:\n${d.diff.split("\n").map((l) => "       " + l).join("\n")}`);
    }
    finish(run.status === "done" ? 0 : 2, `run ${run.status}`);
    return;
  }
  const open = run.packets.filter((p) => p.status === "escalated");
  const active = run.packets.filter((p) => ["pending", "running", "awaiting-review"].includes(p.status));
  if (open.length && active.length === 0) {
    finish(3, `${open.length} escalation(s) hold the run open — resolve them in the board`);
  }
});

ws.on("error", (e) => finish(1, `websocket error: ${e.message}`));
setTimeout(() => finish(4, `timeout after ${timeoutS}s`), timeoutS * 1000);
