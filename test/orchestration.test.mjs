/**
 * M-ORCH — the orchestrator's pure half, pinned: the brief prompt carries
 * every packet's contract and asks for the fenced block; the brief parser
 * validates against the plan (unknown packets dropped + named, missing
 * ones named, bad constraints dropped + named); packetTaskText hands the
 * worker the brief's task + HANDOFF or the generic framing; the review
 * pre-checks decide without a model where they can; the verdict parser
 * never invents a verdict.
 *
 * Boot: node --experimental-strip-types --no-warnings --test test/orchestration.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBriefPrompt, parseBrief, unavailableBrief, packetTaskText, briefThreadSummaries,
  preReviewChecks, preCheckReport, buildReviewPrompt, parseVerdict, noChangePackets, materializeSystemPackets,
  applyBriefOrdering, MAX_SYSTEM_PACKETS, BRIEF_FENCE, VERDICT_FENCE,
  stackPolicyInputs, MAX_STACK_PROPOSALS,
} from "../src/server/orchestration.ts";

test("M-ORCH.3: the brief may propose SYSTEM packets — validated hard, named when dropped", () => {
  const p = buildBriefPrompt({ task: "x", packets: run().packets, threads });
  assert.match(p, /SYSTEM PACKETS \(work NO thread owns\)/);
  assert.match(p, /never propose more than three/);
  // the fair test's failure mode, named: a changed STORED shape needs a migration packet, not a note
  assert.match(p, /ASK EXPLICITLY: does the objective change a STORED shape/);
  assert.match(p, /a note that names the gap and leaves it is the failure mode this exists to end/);
  assert.match(p, /"extraPackets"/);
  const text = "```" + BRIEF_FENCE + "\n" + JSON.stringify({
    objective: "o",
    packets: [{ id: "p1", task: "t", handoff: [] }, { id: "p2", task: "t2", handoff: [] }],
    extraPackets: [
      { id: "whatever", title: " Migration ", task: "add region column to existing DBs", handoff: ["keep executemany", ""],
        files: ["api/migrations.py", "api/db.py", "../escape.py", "/abs.py"], rationale: "no thread owns a migration",
        integrates: ["api/db.py:insert_order", "api/app.py:create_order", "ghost.py:nope"], after: ["p1", "p9"] },
      { title: "no files", task: "t", files: [] },
      { title: "ok2", task: "t", files: ["b.py"] },
      { title: "ok3", task: "t", files: ["c.py"] },
      { title: "over the cap", task: "t", files: ["d.py"] },
    ],
  }) + "\n```";
  const parsed = parseBrief(text, run(), new Set(["api/app.py:create_order", "api/db.py:insert_order", "other.py:thing"]));
  const xs = parsed.orchestration.extraPackets;
  assert.equal(xs.length, MAX_SYSTEM_PACKETS, "cap holds");
  assert.deepEqual(xs.map((x) => x.id), ["x1", "x2", "x3"], "ids are minted, never trusted");
  assert.equal(xs[0].title, "Migration");
  assert.deepEqual(xs[0].files, ["api/migrations.py", "api/db.py"], "escaping and absolute paths dropped");
  assert.deepEqual(xs[0].handoff, ["keep executemany"]);
  assert.deepEqual(xs[0].integrates, ["api/db.py:insert_order", "api/app.py:create_order"], "unknown thread dropped");
  assert.deepEqual(xs[0].after, ["p1"], "unknown packet id dropped");
  assert.ok(parsed.problems.some((m) => /system packet 2: needs title, task, and at least one/.test(m)));
  assert.ok(parsed.problems.some((m) => /unknown integration thread\(s\) ghost\.py:nope/.test(m)));
  assert.ok(parsed.problems.some((m) => /over the 3-packet cap/.test(m)));
  assert.match(parsed.orchestration.note, /3 system packet\(s\) proposed/);
  // no extraPackets key at all → field absent, nothing to materialise
  const none = parseBrief("```" + BRIEF_FENCE + "\n" + JSON.stringify({ objective: "o", packets: [] }) + "\n```", run());
  assert.equal(none.orchestration.extraPackets, undefined);
});

test("M-ORCH.3: materializeSystemPackets appends packets ordered after the owners of their files + `after`, idempotently", () => {
  const r = run();
  r.orchestration = {
    status: "ready", objective: "o", packetTasks: {}, globalConstraints: [], storedConstraintIds: [], note: "",
    extraPackets: [
      { id: "x1", title: "migration", task: "t", handoff: ["h"], files: ["api/migrations.py", "api/db.py"], rationale: "r", integrates: ["api/app.py:create_order"], after: [] },
      { id: "x2", title: "wiring", task: "t2", handoff: [], files: ["new/wire.py"], rationale: "", integrates: [], after: ["p2"] },
    ],
  };
  const made = materializeSystemPackets(r);
  assert.equal(made.length, 2);
  const [x1, x2] = made;
  assert.equal(x1.id, "x1");
  assert.equal(x1.plan.kind, "system");
  assert.equal(x1.plan.origin, "brief");
  assert.equal(x1.plan.entryPointId, "system:x1");
  assert.equal(x1.plan.order, 3);
  assert.deepEqual(x1.plan.boundaries.dependsOn, ["api/db.py:insert_order", "api/app.py:create_order"].sort(), "api/db.py is owned by BOTH plan packets → runs after both");
  assert.deepEqual(x1.plan.integrates, ["api/app.py:create_order"]);
  assert.deepEqual(x1.plan.boundaries.outsidePlan.reaches, [], "integration threads inside the plan are not 'outside'");
  assert.deepEqual(x2.plan.boundaries.dependsOn, ["api/app.py:create_order"], "`after: p2` → p2's thread");
  assert.equal(x2.plan.order, 4);
  r.packets.push(...made);
  assert.deepEqual(materializeSystemPackets(r), [], "already materialised → nothing twice");
  // an unavailable brief materialises nothing
  const u = run(); u.orchestration = { status: "unavailable", objective: "", packetTasks: {}, globalConstraints: [], storedConstraintIds: [], note: "", extraPackets: r.orchestration.extraPackets };
  assert.deepEqual(materializeSystemPackets(u), []);
  // the system packet's worker text carries objective, rationale, task, handoff
  const t = packetTaskText(r, x1);
  assert.equal(t.fromBrief, true);
  assert.match(t.task, /SYSTEM PACKET x1 — migration[\s\S]*Why no thread owns this: r[\s\S]*HANDOFF from the orchestrator[\s\S]*- h/);
});

const packet = (id, order, ep, name, files, deps = []) => ({
  id, status: "pending", attempts: 1, evidence: null, escalation: null,
  plan: {
    order, entryPointId: ep, qualifiedName: name, kind: "route", matchedOn: ["`orders`"], score: 3,
    filesReached: files,
    boundaries: { staticallyComplete: true, resolutionGaps: 0, runtimeDispatch: 0, uncaptured: 0, dependsOn: deps, outsidePlan: { reaches: [], reachedBy: [] } },
    skill: { status: "none", note: "" },
  },
});
const run = () => ({
  version: "1", task: "harden `orders` end to end", createdAt: "", status: "draft",
  unmatchedTokens: [], cycles: [], planNote: "", mode: "orchestrated",
  packets: [
    packet("p1", 1, "api/db.py:insert_order", "api/db:insert_order", ["api/db.py"]),
    packet("p2", 2, "api/app.py:create_order", "api/app:create_order", ["api/app.py", "api/db.py"], ["api/db.py:insert_order"]),
  ],
});
const threads = new Map([
  ["api/db.py:insert_order", { entryPointId: "api/db.py:insert_order", qualifiedName: "api/db:insert_order", language: "python", contract: "## Thread contract (IR fact)\nEnters: order\nRound trips inside loops: conn.execute [db]", constraints: null }],
  ["api/app.py:create_order", { entryPointId: "api/app.py:create_order", qualifiedName: "api/app:create_order", language: "python", contract: "## Thread contract (IR fact)\nEnters: (no parameters)", constraints: "## Constraints for this thread (STATED)\n- [proxy · human-stated — authoritative] via nginx" }],
]);

test("the brief prompt carries every packet with its contract + constraints and asks for the fenced block", () => {
  const p = buildBriefPrompt({ task: "harden `orders`", packets: run().packets, threads });
  assert.match(p, /You are the ORCHESTRATOR/);
  assert.match(p, /### packet p1 — api\/db:insert_order \(api\/db\.py:insert_order, order 1, python\)/);
  assert.match(p, /### packet p2 — api\/app:create_order/);
  assert.match(p, /Round trips inside loops: conn\.execute \[db\]/);
  assert.match(p, /via nginx/);
  assert.match(p, /depends on: api\/db\.py:insert_order/);
  assert.match(p, new RegExp("```" + BRIEF_FENCE));
  assert.match(p, /never invent one/);
  // H2H finding: the brief added an unrequested docstring update and stalled a packet at a human gate.
  assert.match(p, /SCOPE RULE[\s\S]*never add a requirement the objective did not state/);
  assert.match(p, /Extras you would like belong in `note`/);
  // packets are listed in build order even if given out of order
  const r = run(); r.packets.reverse();
  const p2 = buildBriefPrompt({ task: "x", packets: r.packets, threads });
  assert.ok(p2.indexOf("### packet p1") < p2.indexOf("### packet p2"));
});

test("parseBrief validates against the plan: unknown packets dropped + named, missing named, bad constraints dropped + named", () => {
  const text = "thinking\n```" + BRIEF_FENCE + "\n" + JSON.stringify({
    objective: " Make orders robust. ",
    packets: [
      { id: "p1", task: "batch the inserts", handoff: ["keep order_items rows {order_id, sku, qty}", "", 42] },
      { id: "p9", task: "phantom" },
      { id: "p2", task: "   " },
    ],
    globalConstraints: [
      { kind: "perf-lever", text: "batch db writes", scope: { files: ["api/"] } },
      { kind: "vibes", text: "nope", scope: { all: true } },
      { kind: "proxy", text: "", scope: { all: true } },
    ],
    note: "nothing owns the migration",
  }) + "\n```";
  const parsed = parseBrief(text, run());
  assert.ok(parsed);
  const o = parsed.orchestration;
  assert.equal(o.status, "ready");
  assert.equal(o.objective, "Make orders robust.");
  assert.deepEqual(Object.keys(o.packetTasks), ["p1"]);
  assert.deepEqual(o.packetTasks.p1.handoff, ["keep order_items rows {order_id, sku, qty}"]);
  assert.deepEqual(parsed.globalConstraints, [{ kind: "perf-lever", text: "batch db writes", scope: { files: ["api/"] } }]);
  assert.deepEqual(o.storedConstraintIds, []);
  assert.match(o.note, /1\/2 packet task\(s\), 1 global constraint\(s\)/);
  assert.match(o.note, /orchestrator note: nothing owns the migration/);
  assert.ok(parsed.problems.some((x) => /unknown packet p9/.test(x)));
  assert.ok(parsed.problems.some((x) => /packet p2: empty task/.test(x)));
  assert.ok(parsed.problems.some((x) => /packet p2 \(api\/app:create_order\) has no brief task/.test(x)));
  assert.equal(parsed.problems.filter((x) => /global constraint dropped/.test(x)).length, 2);
  // the LAST block wins; no block / no objective / bad JSON → null
  assert.equal(parseBrief("no block here", run()), null);
  assert.equal(parseBrief("```" + BRIEF_FENCE + "\n{\"packets\": []}\n```", run()), null);
  assert.equal(parseBrief("```" + BRIEF_FENCE + "\n{not json\n```", run()), null);
  assert.equal(unavailableBrief("spawn failed").status, "unavailable");
  assert.match(unavailableBrief("spawn failed").note, /generic run task/);
});

test("packetTaskText hands the worker the brief task + HANDOFF, or the generic framing", () => {
  const r = run();
  assert.equal(packetTaskText(r, r.packets[0]).fromBrief, false);
  assert.match(packetTaskText(r, r.packets[0]).task, /do YOUR PART of the ratified run task[\s\S]*RUN TASK: harden `orders` end to end/);
  r.orchestration = {
    status: "ready", objective: "Make orders robust.", storedConstraintIds: [], globalConstraints: [], note: "",
    packetTasks: { p1: { task: "batch the inserts", handoff: ["keep order_items rows", "one commit per order"] } },
  };
  const t = packetTaskText(r, r.packets[0]);
  assert.equal(t.fromBrief, true);
  assert.match(t.task, /OBJECTIVE \(confirmed by the human\): Make orders robust\./);
  assert.match(t.task, /YOUR PACKET \(written by the orchestrator\): batch the inserts/);
  assert.match(t.task, /HANDOFF from the orchestrator[\s\S]*- keep order_items rows\n- one commit per order/);
  assert.equal(packetTaskText(r, r.packets[1]).fromBrief, false, "a packet without a brief task falls back honestly");
  r.orchestration.status = "unavailable";
  assert.equal(packetTaskText(r, r.packets[0]).fromBrief, false);
});

test("pre-review checks: broken worker → escalate to the human; out-of-remit diff → reject; clean → ask the model", () => {
  const p = run().packets[0];
  const ev = (summary, diffs = []) => ({ summary, irDelta: null, diffs, assertions: null, blindSpots: null });
  assert.deepEqual(preReviewChecks(p, ev("WORKER SESSION FAILED (spawn error)")), { verdict: "escalate", reason: "worker session failed — a human must look" });
  assert.equal(preReviewChecks(p, ev("WORKER BROKE THE OUTPUT CONTRACT (no block)")).verdict, "escalate");
  assert.deepEqual(preReviewChecks(p, ev("done", [{ file: "api/app.py", nodeId: null, diff: "+x" }])), { verdict: "reject", reason: "edits outside the packet's files: api/app.py" });
  assert.equal(preReviewChecks(p, ev("done", [{ file: "api/db.py", nodeId: null, diff: "+x" }])), null);
  // M-ORCH.4 — the EDIT SCOPE narrows the remit: an in-remit file outside the scope is rejected, named as such.
  assert.deepEqual(preReviewChecks(p, ev("done", [{ file: "api/db.py", nodeId: null, diff: "+x" }]), { scope: ["api/app.py"] }),
    { verdict: "reject", reason: "edits outside the packet's edit scope: api/db.py" });
});

test("M-ORCH.4 pre-check APPROVAL: clean evidence approves without a model; every unusual sign hands it to the model with reasons", () => {
  const base = run().packets[0];
  const packet = { ...base, attempts: 1, plan: { ...base.plan, contract: { params: 1, returns: "dict", effects: {}, roundTrips: 0, constraints: 0 },
    boundaries: { ...base.plan.boundaries, resolutionGaps: 1, runtimeDispatch: 0, uncaptured: 0 } } };
  const clean = {
    summary: "did it",
    diffs: [{ file: "api/db.py", nodeId: null, diff: "+x" }],
    irDelta: [{ file: "api/db.py", delta: { summary: "1 node changed" } }],
    assertions: { invariants: ["step 1 is call 'insert'"] },
    blindSpots: { totals: { nodes: 4, resolutionGaps: 1, runtimeDispatch: 0, uncaptured: 0, effects: 1 }, staticallyComplete: false },
  };
  const ctx = { scope: ["api/db.py"], autoApprove: true, contractAfter: { params: 1, returns: "dict" } };
  const ok = preCheckReport(packet, clean, ctx);
  assert.equal(ok.decision.verdict, "approve");
  assert.match(ok.decision.reason, /^pre-checks passed — 1 file\(s\) changed inside the edit scope \(api\/db\.py\); every edited file re-parsed and re-linked; entry-point signature unchanged \(1 param\(s\), returns dict\); no new resolution gaps, runtime dispatch, or uncaptured effects; worker reported done\. No model read this diff\.$/);
  assert.deepEqual(ok.needsEyes, []);
  // Without the policy, the same evidence is NOT approved here (the model reads it).
  assert.equal(preCheckReport(packet, clean, { ...ctx, autoApprove: false }).decision, null);
  const eyes = (pk, ev, c) => preCheckReport(pk, ev, c ?? ctx).needsEyes;
  // Each of these alone hands the packet to the model, naming why:
  assert.match(eyes({ ...packet, plan: { ...packet.plan, kind: "system" } }, clean).join("|"), /system packet/);
  assert.match(eyes({ ...packet, attempts: 2 }, clean).join("|"), /attempt 2 after a rejection/);
  assert.match(eyes(packet, { ...clean, diffs: [], irDelta: null }).join("|"), /no bytes changed/);
  assert.match(eyes(packet, { ...clean, irDelta: null }).join("|"), /no IR delta for api\/db\.py/);
  assert.match(eyes(packet, clean, { ...ctx, contractAfter: { params: 2, returns: "dict" } }).join("|"), /entry-point signature changed \(1 param\(s\) → 2; returns dict → dict\)/);
  assert.match(eyes(packet, clean, { ...ctx, contractAfter: undefined }).join("|"), /contract unavailable/);
  assert.match(eyes({ ...packet, plan: { ...packet.plan, contract: undefined } }, clean).join("|"), /contract unavailable/);
  assert.match(eyes(packet, { ...clean, blindSpots: { totals: { nodes: 5, resolutionGaps: 2, runtimeDispatch: 1, uncaptured: 0, effects: 1 } } }).join("|"),
    /new resolutionGaps \(1 → 2\), runtimeDispatch \(0 → 1\)/);
  assert.match(eyes(packet, { ...clean, blindSpots: null }).join("|"), /no post-edit blind-spot totals/);
  // A thread that vanished after the edit is an ESCALATION, policy or not.
  assert.deepEqual(preCheckReport(packet, clean, { ...ctx, contractAfter: null }).decision,
    { verdict: "escalate", reason: "the packet's entry point is no longer in the envelope after the edit — a human must look" });
  // The review prompt names why the pre-checks handed the packet over.
  const prompt = buildReviewPrompt({ run: run(), packet, task: "t", evidence: clean, contract: null, constraints: null, preCheckNotes: ["no bytes changed — the task may have required a change"] });
  assert.match(prompt, /WHY THE DETERMINISTIC PRE-CHECKS HANDED THIS TO YOU: no bytes changed — the task may have required a change/);
});

test("M-ORCH.4: the brief declares each packet's EDIT SCOPE (`files`) — a subset of its thread's files, widened never", () => {
  const p = buildBriefPrompt({ task: "x", packets: run().packets, threads });
  assert.match(p, /EDIT SCOPE \(`files`\): for every packet that has a task, list the files its worker may CHANGE/);
  assert.match(p, /Packets whose edit scopes do not overlap run IN PARALLEL/);
  assert.match(p, /"files": \[\s*"<file this worker may change>"/);
  const r = run();
  const remit = r.packets[1].plan.filesReached; // p2: api/app.py, api/db.py
  const text = "```" + BRIEF_FENCE + "\n" + JSON.stringify({
    objective: "o",
    packets: [
      { id: "p1", task: "t", handoff: [], files: [] },
      { id: "p2", task: "t2", handoff: [], files: [remit[1], " " + remit[1], "../outside.py", "ghost.py"] },
    ],
  }) + "\n```";
  const parsed = parseBrief(text, r);
  assert.deepEqual(parsed.orchestration.packetTasks.p2.files, [remit[1]], "deduplicated, trimmed, remit-only");
  assert.equal(parsed.orchestration.packetTasks.p1.files, undefined, "empty scope = the whole remit");
  assert.ok(parsed.problems.some((m) => /packet p2: edit scope named file\(s\) outside its thread \(\.\.\/outside\.py, ghost\.py\) — dropped/.test(m)));
});

test("M-ORCH.4: the brief may ORDER packets (`after`) for on-disk dependencies the call graph cannot see; cycles are refused and named", () => {
  const p = buildBriefPrompt({ task: "x", packets: run().packets, threads });
  assert.match(p, /ORDER \(`after`\): the plan orders packets by the CALL graph only/);
  assert.match(p, /"after": \[/);
  // p2 already depends on p1 (call graph). Ask p1 to run after p2 → cycle → refused.
  const r = run();
  const text = "```" + BRIEF_FENCE + "\n" + JSON.stringify({
    objective: "o",
    packets: [
      { id: "p1", task: "t", handoff: [], after: ["p2", "p1", "p9", "p2"] },
      { id: "p2", task: "t2", handoff: [], after: ["p1"] },
    ],
  }) + "\n```";
  const parsed = parseBrief(text, r);
  assert.deepEqual(parsed.orchestration.packetTasks.p1.after, ["p2"], "self and unknown dropped, deduplicated");
  assert.ok(parsed.problems.some((m) => /packet p1: after named unknown\/self packet id\(s\) \(p1, p9\) — dropped/.test(m)));
  assert.deepEqual(parsed.orchestration.packetTasks.p2.after, ["p1"]);
  r.orchestration = parsed.orchestration;
  const problems = applyBriefOrdering(r);
  assert.deepEqual(problems, ["packet p1: after p2 would close a cycle — dropped"]);
  assert.deepEqual(r.packets[0].plan.boundaries.dependsOn, [], "p1 untouched");
  assert.deepEqual(r.packets[1].plan.boundaries.dependsOn, ["api/db.py:insert_order"], "p2 already had it — no duplicate");
  // A genuine on-disk dependency lands as a call-graph-shaped edge; idempotent.
  const r2 = run();
  r2.packets[1].plan.boundaries.dependsOn = [];
  r2.orchestration = { ...parsed.orchestration, packetTasks: { p1: { task: "t", handoff: [] }, p2: { task: "t", handoff: [], after: ["p1"] } } };
  assert.deepEqual(applyBriefOrdering(r2), []);
  assert.deepEqual(r2.packets[1].plan.boundaries.dependsOn, ["api/db.py:insert_order"]);
  assert.deepEqual(applyBriefOrdering(r2), []);
  assert.deepEqual(r2.packets[1].plan.boundaries.dependsOn, ["api/db.py:insert_order"]);
});

test("the review prompt carries objective, task, evidence, and the verdict rules; parseVerdict never invents", () => {
  const r = run();
  r.orchestration = { status: "ready", objective: "Make orders robust.", storedConstraintIds: [], globalConstraints: [], note: "", packetTasks: {} };
  const p = { ...r.packets[0], status: "awaiting-review" };
  const prompt = buildReviewPrompt({
    run: r, packet: p, task: "batch the inserts",
    evidence: {
      summary: "inserted a marker", irDelta: [{ file: "api/db.py", delta: { added: 1 } }],
      diffs: [{ file: "api/db.py", nodeId: null, diff: "-a\n+b" }],
      assertions: { invariants: ["step 1 is seed 'insert_order'"] }, blindSpots: { totals: { nodes: 5 }, staticallyComplete: true },
    },
    contract: "## Thread contract (IR fact)\nEnters: order", constraints: null,
  });
  assert.match(prompt, /OBJECTIVE: Make orders robust\./);
  assert.match(prompt, /PACKET p1: api\/db:insert_order/);
  assert.match(prompt, /THE TASK THIS WORKER WAS GIVEN:\nbatch the inserts/);
  assert.match(prompt, /WORKER SELF-REPORT \(unverified\): inserted a marker/);
  assert.match(prompt, /--- api\/db\.py\n-a\n\+b/);
  assert.match(prompt, /step 1 is seed 'insert_order'/);
  assert.match(prompt, /A green structural check proves self-consistency/);
  assert.match(prompt, new RegExp("```" + VERDICT_FENCE));
  const long = buildReviewPrompt({ run: r, packet: p, task: "t", contract: null, constraints: null,
    evidence: { summary: null, irDelta: null, assertions: null, blindSpots: null, diffs: [{ file: "api/db.py", nodeId: null, diff: "+x".repeat(5000) }] } });
  assert.match(long, /diff truncated — treat the unseen part as UNREVIEWED/);

  assert.deepEqual(parseVerdict("```" + VERDICT_FENCE + "\n{\"verdict\":\"reject\",\"reason\":\"wrong file\"}\n```"), { verdict: "reject", reason: "wrong file" });
  assert.deepEqual(parseVerdict("```" + VERDICT_FENCE + "\n{\"verdict\":\"approve\"}\n```"), { verdict: "approve", reason: "(no reason given)" });
  assert.equal(parseVerdict("```" + VERDICT_FENCE + "\n{\"verdict\":\"maybe\"}\n```"), null);
  assert.equal(parseVerdict("approve!"), null);
  assert.equal(parseVerdict(null), null);
});

test("M-ORCH.2: the brief may mark a packet no-change (strict boolean); noChangePackets lists them only from a READY brief", () => {
  const p = buildBriefPrompt({ task: "x", packets: run().packets, threads });
  assert.match(p, /NO-CHANGE PACKETS: .*set "noChange": true/);
  assert.match(p, /"noChange": true/);
  const text = "```" + BRIEF_FENCE + "\n" + JSON.stringify({
    objective: "o",
    packets: [
      { id: "p1", task: "do it", handoff: ["keep shape"] },
      { id: "p2", noChange: true, task: "health is untouched by the objective", handoff: [] },
    ],
  }) + "\n```";
  const r = run();
  const parsed = parseBrief(text, r);
  assert.deepEqual(parsed.orchestration.packetTasks.p1, { task: "do it", handoff: ["keep shape"] });
  assert.deepEqual(parsed.orchestration.packetTasks.p2, { task: "health is untouched by the objective", handoff: [], noChange: true });
  // a truthy non-boolean never counts
  const loose = parseBrief("```" + BRIEF_FENCE + "\n" + JSON.stringify({ objective: "o", packets: [{ id: "p2", noChange: "yes", task: "t" }] }) + "\n```", run());
  assert.equal(loose.orchestration.packetTasks.p2.noChange, undefined);
  r.orchestration = parsed.orchestration;
  assert.deepEqual(noChangePackets(r), [{ id: "p2", reason: "health is untouched by the objective" }]);
  r.orchestration.status = "unavailable";
  assert.deepEqual(noChangePackets(r), [], "an unavailable brief settles nothing");
  r.orchestration.status = "ready";
  r.packets[1].status = "running";
  assert.deepEqual(noChangePackets(r), [], "only PENDING packets are settled");
  // a no-change packet's worker text (never used, but must not lie) still carries the reason
  assert.match(packetTaskText(r, r.packets[1]).task, /health is untouched/);
});

test("briefThreadSummaries reads one summary per packet thread, tolerating a missing contract", () => {
  const s = briefThreadSummaries(run(), (ep) => ep.endsWith("insert_order") ? { contract: "C", constraints: null, language: "python" } : null);
  assert.equal(s.get("api/db.py:insert_order").contract, "C");
  assert.equal(s.get("api/app.py:create_order").contract, null);
  assert.equal(s.get("api/app.py:create_order").language, "unknown");
});

test("M-STACK.3: the brief carries the PROJECT stack before the packets, and each packet's Stack line", () => {
  const r = run();
  const threads = new Map([[r.packets[0].plan.entryPointId, {
    entryPointId: r.packets[0].plan.entryPointId, qualifiedName: "q", language: "python",
    contract: "## Thread contract (IR fact — auto-generated, do not edit)\nEnters: x",
    constraints: null,
    stack: "Stack: telemetry.http_client [http-client, project funnel wrapping requests] CALLED; requests [http-client] present in the files, not called on this thread",
  }]]);
  const projectStack = "## Project stack (IR fact — derived from imports, calls, includes and manifests; a DECISION about a tool is stated separately below)\n- HTTP client: telemetry.http_client (project funnel wrapping requests; 2 site(s) in 1 file(s))";
  const p = buildBriefPrompt({ task: "rate limit /ingest", packets: r.packets, threads, projectStack });
  const at = (re) => p.search(re);
  // M-BOUNDARY.2: the packet line reaches the brief with USE marked, so a
  // plan can tell "this thread calls the wrapper" from "a file it walks
  // happens to import requests".
  assert.match(p, /telemetry\.http_client \[http-client, project funnel wrapping requests\] CALLED/);
  assert.match(p, /requests \[http-client\] present in the files, not called on this thread/);
  assert.ok(at(/## Project stack/) > at(/RUN TASK/), "the stack follows the task");
  assert.ok(at(/## Project stack/) < at(/PACKETS \(dependencies-first/), "and precedes the packets");
  assert.ok(at(/Stack: telemetry\.http_client/) < at(/## Thread contract/), "a packet's Stack line leads its contract");
  assert.match(p, /a packet's task names the EXISTING tools its work uses/);
  assert.match(p, /Never assume a tool that is not in that block/);
  // No index ⇒ the pre-M-STACK brief shape.
  const bare = buildBriefPrompt({ task: "t", packets: r.packets, threads: new Map() });
  assert.doesNotMatch(bare, /## Project stack/);
});

// ── M-STACK.4 — the brief may propose a TOOL; the human confirms it ──

const briefWith = (extra) => "```" + BRIEF_FENCE + "\n" + JSON.stringify({
  objective: "rate-limit /ingest per device",
  packets: [{ id: "p1", task: "t1", handoff: [] }, { id: "p2", task: "t2", handoff: [] }],
  ...extra,
}) + "\n```";

test("M-STACK.4: stackProposals are validated hard — capped, named when dropped, defaults honest", () => {
  const parsed = parseBrief(briefWith({
    stackProposals: [
      { tool: "redis", role: "cache", why: "no cross-process state exists", rule: "require", alternatives: [{ tool: "sqlite3", whyNot: "a write per request" }], scope: { files: ["api/"] } },
      { tool: "bad name", why: "x" },
      { tool: "mystery", role: "cache" },
      { tool: "vibes", why: "y", scope: { entryPointIds: [] , files: []} },
      { tool: "one", why: "a" }, { tool: "two", why: "b" }, { tool: "three", why: "c" },
    ],
  }), run());
  const props = parsed.orchestration.stackProposals;
  assert.deepEqual(props.map((p) => p.tool), ["redis", "one", "two"], "cap of " + MAX_STACK_PROPOSALS + " applied in order");
  assert.equal(props[0].rule, "require");
  assert.equal(props[0].role, "cache");
  assert.deepEqual(props[0].scope, { files: ["api/"] });
  assert.deepEqual(props[0].alternatives, [{ tool: "sqlite3", whyNot: "a write per request" }]);
  // rule defaults to the softer one; a proposal with no alternatives keeps an empty list rather than an invented one.
  assert.equal(props[1].rule, "prefer");
  assert.deepEqual(props[1].alternatives, []);
  // Everything dropped is NAMED — a silent drop would read as "nothing new was needed".
  const note = parsed.orchestration.note;
  assert.match(note, /needs a tool name — dropped/);
  assert.match(note, /stack proposal mystery: needs a "why"/);
  assert.match(note, /stack proposal vibes: scope must name/);
  assert.match(note, /over the 3-tool cap — dropped/);
  assert.match(note, /3 new tool\(s\) proposed/);
  // An unknown role is dropped, not invented.
  const oddRole = parseBrief(briefWith({ stackProposals: [{ tool: "redis", role: "vibes", why: "w" }] }), run());
  assert.equal(oddRole.orchestration.stackProposals[0].role, undefined);
  // No proposals ⇒ the field is absent entirely (pre-M-STACK brief shape).
  assert.equal(parseBrief(briefWith({}), run()).orchestration.stackProposals, undefined);
});

test("M-STACK.4: a confirmed proposal becomes a stack-policy scoped by the tool — and installs nothing", () => {
  const r = run();
  const parsed = parseBrief(briefWith({
    stackProposals: [{
      tool: "redis", role: "cache", rule: "prefer",
      why: "the objective needs a shared per-device counter; nothing in the stack keeps cross-process state",
      alternatives: [{ tool: "sqlite3", whyNot: "a write per request on the hot path" }],
      scope: { all: true },
    }],
  }), r);
  r.orchestration = parsed.orchestration;
  const inputs = stackPolicyInputs(r);
  assert.equal(inputs.length, 1);
  const c = inputs[0];
  assert.equal(c.kind, "stack-policy");
  assert.deepEqual(c.policy, { tool: "redis", role: "cache", rule: "prefer", reason: "the objective needs a shared per-device counter; nothing in the stack keeps cross-process state" });
  // The scope keeps what the brief asked for AND adds the tool, so the
  // policy follows whatever adopts it later without a scope edit.
  assert.deepEqual(c.scope, { all: true, stack: ["redis"] });
  assert.match(c.text, /^Prefer redis as this project's cache:/);
  assert.match(c.text, /Considered instead: sqlite3 \(a write per request on the hot path\)/);
  assert.match(c.note, /confirmed by the human at the objective gate — nothing was installed/);

  // "require" reads as a harder sentence; a proposal with no alternatives says so.
  r.orchestration.stackProposals = [{ tool: "torch", rule: "require", why: "the model is a tensor program", alternatives: [], scope: { files: ["model.py"] } }];
  const hard = stackPolicyInputs(r)[0];
  assert.match(hard.text, /^Use torch: /);
  assert.match(hard.text, /No alternatives were named\./);
  assert.deepEqual(hard.scope, { files: ["model.py"], stack: ["torch"] });

  // A brief that is not READY materialises nothing — the gate is the only door.
  assert.deepEqual(stackPolicyInputs({ ...r, orchestration: { ...r.orchestration, status: "drafting" } }), []);
  assert.deepEqual(stackPolicyInputs({ ...r, orchestration: undefined }), []);
});

test("M-STACK.4: the brief prompt asks for a proposal instead of an assumption", () => {
  const p = buildBriefPrompt({ task: "t", packets: run().packets, threads });
  assert.match(p, /A NEW TOOL \(`stackProposals`\)/);
  assert.match(p, /never assume it, never have a worker add it/);
  assert.match(p, /a proposal with no alternatives considered is a preference, not a decision/);
  assert.match(p, /nothing installs a package/);
  assert.match(p, /If an existing tool CAN do the job — even clumsily — say so/);
  assert.match(p, /"stackProposals"/);
});

// ── M-STACK.5 — deterministic stack pre-checks ──────────────────────

test("M-STACK.5: a forbidden tool in the IR delta is a pre-check REJECT naming the policy and the alternative", () => {
  const base = run().packets[0];
  const packet = { ...base, attempts: 1, plan: { ...base.plan, contract: { params: 1, returns: "dict", effects: {}, roundTrips: 0, constraints: 0 } } };
  const clean = {
    summary: "did it",
    diffs: [{ file: "api/db.py", nodeId: null, diff: "+import requests" }],
    irDelta: [{ file: "api/db.py", delta: { nodesAdded: [{ id: "module/requests.import", type: "import" }] } }],
    assertions: { invariants: [] },
    blindSpots: { totals: { resolutionGaps: 0, runtimeDispatch: 0, uncaptured: 0 } },
  };
  const ctx = { scope: ["api/db.py"], autoApprove: true, contractAfter: { params: 1, returns: "dict" } };
  const policy = { id: "c1", source: "human", policy: { tool: "requests", rule: "replace-with", with: "api.http_client", reason: "the egress proxy lives in the wrapper" } };
  const added = [{ tool: "requests", role: "http-client", origin: "third-party", file: "api/db.py", alsoElsewhere: true }];

  const rejected = preCheckReport(packet, clean, { ...ctx, addedTools: added, policies: [policy] });
  assert.equal(rejected.decision.verdict, "reject");
  assert.match(rejected.decision.reason, /introduced requests in api\/db\.py/);
  assert.match(rejected.decision.reason, /policy c1 \(human-stated\) says to replace with api\.http_client/);
  assert.match(rejected.decision.reason, /Use api\.http_client instead\./, "the retry notice carries the alternative");
  assert.match(rejected.decision.reason, /Reason given: the egress proxy lives in the wrapper/);

  // A "forbid" rule with no alternative rejects too, without inventing one.
  const forbid = preCheckReport(packet, clean, { ...ctx, addedTools: added, policies: [{ id: "c2", source: "orchestrator", policy: { tool: "requests", rule: "forbid" } }] });
  assert.match(forbid.decision.reason, /policy c2 \(orchestrator-stated\) forbids\.$/);

  // The stack check is NOT a matter of review policy: a forbidden tool is
  // a fact, and it rejects even when the model would otherwise read the diff.
  assert.equal(
    preCheckReport(packet, clean, { ...ctx, autoApprove: false, addedTools: added, policies: [policy] }).decision.verdict,
    "reject",
  );
  // prefer / require never reject on their own — they are not checkable that way.
  assert.equal(preCheckReport(packet, clean, { ...ctx, addedTools: added, policies: [{ id: "c3", source: "human", policy: { tool: "requests", rule: "prefer" } }] }).decision.verdict, "approve");
  // A policy about a DIFFERENT tool is not a hit.
  assert.equal(preCheckReport(packet, clean, { ...ctx, addedTools: added, policies: [{ id: "c4", source: "human", policy: { tool: "httpx", rule: "forbid" } }] }).decision.verdict, "approve");
});

test("M-STACK.5: a tool the project has never used is needsEyes, never auto-approved; a clean delta still approves", () => {
  const base = run().packets[0];
  const packet = { ...base, attempts: 1, plan: { ...base.plan, contract: { params: 1, returns: "dict", effects: {}, roundTrips: 0, constraints: 0 } } };
  const clean = {
    summary: "did it",
    diffs: [{ file: "api/db.py", nodeId: null, diff: "+x" }],
    irDelta: [{ file: "api/db.py", delta: { nodesAdded: [{ id: "module/redis.import", type: "import" }] } }],
    assertions: { invariants: [] },
    blindSpots: { totals: { resolutionGaps: 0, runtimeDispatch: 0, uncaptured: 0 } },
  };
  const ctx = { scope: ["api/db.py"], autoApprove: true, contractAfter: { params: 1, returns: "dict" } };

  const fresh = preCheckReport(packet, clean, { ...ctx, policies: [], addedTools: [{ tool: "redis", role: "cache", origin: "third-party", file: "api/db.py", alsoElsewhere: false }] });
  assert.equal(fresh.decision, null, "a new dependency is never approved by a deterministic check");
  assert.match(fresh.needsEyes.join("|"), /new third-party tool redis in api\/db\.py — the project used it nowhere else/);

  // Already used elsewhere ⇒ not a dependency decision ⇒ still approvable.
  const reused = preCheckReport(packet, clean, { ...ctx, policies: [], addedTools: [{ tool: "redis", role: "cache", origin: "third-party", file: "api/db.py", alsoElsewhere: true }] });
  assert.equal(reused.decision.verdict, "approve");
  // Stdlib is not a dependency decision either.
  assert.equal(preCheckReport(packet, clean, { ...ctx, policies: [], addedTools: [{ tool: "json", role: "runtime", origin: "stdlib", file: "api/db.py", alsoElsewhere: false }] }).decision.verdict, "approve");
  // No stack context at all ⇒ the M-ORCH.4 behaviour, unchanged.
  assert.equal(preCheckReport(packet, clean, ctx).decision.verdict, "approve");
});

test("M-BOUNDARY.3: the stack reject names the CALL SITE, and an import-only add says so", () => {
  const packet = { id: "p1", status: "awaiting-review", attempts: 1, plan: { kind: "thread", filesReached: ["models.py"] } };
  const evidence = { summary: "done", diffs: [{ file: "models.py" }], irDelta: [], blindSpots: null };
  const policies = [{
    id: "c1", source: "human",
    policy: { tool: "requests", role: "http-client", rule: "replace-with", with: "models.http_client", reason: "the proxy and the token live in the wrapper" },
  }];
  const called = preCheckReport(packet, evidence, {
    scope: ["models.py"], autoApprove: true, policies,
    addedTools: [{
      tool: "requests", role: "http-client", origin: "third-party", file: "models.py",
      site: "call", nodeId: "module/list_users.fn/get.call", preview: "requests.get(url)",
      alsoElsewhere: false,
    }],
  });
  assert.equal(called.decision.verdict, "reject");
  // The M-STACK.5 wording is intact (the e2e pins it) and now carries the line to change.
  assert.match(called.decision.reason, /introduced requests in models\.py/);
  assert.match(called.decision.reason, /called at module\/list_users\.fn\/get\.call: `requests\.get\(url\)`/);
  assert.match(called.decision.reason, /Use models\.http_client instead\./);

  const imported = preCheckReport(packet, evidence, {
    scope: ["models.py"], autoApprove: true, policies,
    addedTools: [{
      tool: "requests", role: "http-client", origin: "third-party", file: "models.py",
      site: "import", nodeId: "module/requests.import", alsoElsewhere: false,
    }],
  });
  assert.match(imported.decision.reason, /imported at module\/requests\.import[^)]*no call through it yet/);
});

// ── Quality layer in the pre-checks (RUN3.md §9): gates, advisories, the three new lines ──
import { looseningLines, testsTouchedLine, isTestFile } from "../src/server/orchestration.ts";

test("quality layer: a non-gating violated is an ADVISORY line (never rejects, never needs eyes); a gating one rejects; unverifiable splits the same way", () => {
  const base = run().packets[0];
  const packet = { ...base, attempts: 1, plan: { ...base.plan, contract: { params: 1, returns: "dict", effects: {}, roundTrips: 0, constraints: 0 },
    boundaries: { ...base.plan.boundaries, resolutionGaps: 1, runtimeDispatch: 0, uncaptured: 0 } } };
  const clean = {
    summary: "did it",
    diffs: [{ file: "api/db.py", nodeId: null, diff: "+x" }],
    irDelta: [{ file: "api/db.py", delta: { summary: "1 node changed" } }],
    assertions: null,
    blindSpots: { totals: { nodes: 4, resolutionGaps: 1, runtimeDispatch: 0, uncaptured: 0, effects: 1 }, staticallyComplete: false },
  };
  const ctx = { scope: ["api/db.py"], autoApprove: true, contractAfter: { params: 1, returns: "dict" } };
  const violated = { id: "q1", source: "human", described: "a change to db.py ships with a test", verdict: "violated", reason: "db.py changed and tests did not" };
  // Non-gating (a DEMOTE / CANDIDATE verb): advisory, still approved by the pre-checks.
  const adv = preCheckReport(packet, clean, { ...ctx, constraintChecks: [{ ...violated, gates: false }] });
  assert.equal(adv.decision?.verdict, "approve", JSON.stringify(adv));
  assert.deepEqual(adv.needsEyes, []);
  assert.equal(adv.advisories.filter((a) => /q1 violated/.test(a)).length, 1);
  assert.match(adv.advisories.find((a) => /q1 violated/.test(a)), /never rejects/);
  // Gating (a MAY-GATE or M-GRAMMAR verb): reject, whatever the review policy.
  const rej = preCheckReport(packet, clean, { ...ctx, constraintChecks: [{ ...violated, gates: true }] });
  assert.equal(rej.decision?.verdict, "reject");
  assert.match(rej.decision.reason, /breaks constraint q1/);
  const rejFull = preCheckReport(packet, clean, { ...ctx, autoApprove: false, constraintChecks: [violated] });
  assert.equal(rejFull.decision?.verdict, "reject", "a violated fact rejects under the full policy too; gates defaults to true");
  // Unverifiable: eyes when gating, advisory when not.
  const unv = { ...violated, verdict: "unverifiable", reason: "one dynamic call could be it" };
  assert.match(preCheckReport(packet, clean, { ...ctx, constraintChecks: [unv] }).needsEyes.join("|"), /could not be checked/);
  const unvAdv = preCheckReport(packet, clean, { ...ctx, constraintChecks: [{ ...unv, gates: false }] });
  assert.equal(unvAdv.decision?.verdict, "approve");
  assert.match(unvAdv.advisories.join("|"), /q1 unverifiable/);
  // tests-touched rode along as an advisory in every case above (db.py, no test).
  assert.match(adv.advisories.join("|"), /tests-touched: the delta changed 1 file\(s\)/);
  // The evidence a test file makes it go away.
  const withTest = { ...clean, diffs: [...clean.diffs, { file: "tests/test_db.py", nodeId: null, diff: "+y" }], irDelta: [...clean.irDelta, { file: "tests/test_db.py", delta: { summary: "1" } }] };
  const ok = preCheckReport(packet, withTest, { ...ctx, scope: ["api/db.py", "tests/test_db.py"] });
  assert.ok(!ok.advisories.some((a) => /^tests-touched/.test(a)));
});

test("quality layer: loosening is LOUD — a removed exit, a removed test, a silenced test each need eyes; unattributed growth needs eyes", () => {
  const base = run().packets[0];
  const packet = { ...base, attempts: 1, plan: { ...base.plan, contract: { params: 1, returns: "dict", effects: {}, roundTrips: 0, constraints: 0 },
    boundaries: { ...base.plan.boundaries, resolutionGaps: 1, runtimeDispatch: 0, uncaptured: 0 } } };
  const ctx = { scope: ["api/db.py", "tests/test_db.py"], autoApprove: true, contractAfter: { params: 1, returns: "dict" } };
  const ev = (irDelta, diffs) => ({ summary: "did it", diffs, irDelta, assertions: null,
    blindSpots: { totals: { nodes: 4, resolutionGaps: 1, runtimeDispatch: 0, uncaptured: 0, effects: 1 }, staticallyComplete: false } });
  const exitRemoved = ev([{ file: "api/db.py", delta: { nodesRemoved: [{ id: "module/insert.fn/if@0/raise@0", type: "raise_stmt" }] } }], [{ file: "api/db.py", nodeId: null, diff: "-    raise ValueError" }]);
  const r1 = preCheckReport(packet, exitRemoved, ctx);
  assert.equal(r1.decision, null, "never auto-approved");
  assert.match(r1.needsEyes.join("|"), /loosening: 1 raise\/return node\(s\) removed in api\/db\.py \(module\/insert\.fn\/if@0\/raise@0\)/);
  const testRemoved = ev([{ file: "tests/test_db.py", delta: { nodesRemoved: [{ id: "module/test_insert.fn", type: "function_def", name: "test_insert" }] } }], [{ file: "tests/test_db.py", nodeId: null, diff: "-def test_insert" }]);
  assert.match(preCheckReport(packet, testRemoved, ctx).needsEyes.join("|"), /loosening: test function\(s\) removed in tests\/test_db\.py \(test_insert\)/);
  const skipped = ev([{ file: "tests/test_db.py", delta: { summary: "1" } }], [{ file: "tests/test_db.py", nodeId: null, diff: "+    @unittest.skip(\"later\")\n     def test_insert" }]);
  assert.match(preCheckReport(packet, skipped, ctx).needsEyes.join("|"), /loosening: a skip marker was added in tests\/test_db\.py/);
  // Pure lines.
  assert.deepEqual(looseningLines(ev([{ file: "api/db.py", delta: { nodesRemoved: [{ id: "module/x.assign", type: "assignment" }] } }], [])), [], "a removed assignment is not a loosening");
  assert.equal(testsTouchedLine(ev(null, [])), null, "no diff, no line");
  assert.ok(isTestFile("test/e2e/x.spec.ts") && isTestFile("tests/test_db.py") && isTestFile("pkg/foo_test.go") && !isTestFile("api/db.py") && !isTestFile("contest/db.py"));
  // Unattributed boundaries: growth needs eyes, otherwise a passed line.
  const clean = ev([{ file: "api/db.py", delta: { summary: "1" } }], [{ file: "api/db.py", nodeId: null, diff: "+x" }]);
  const grew = preCheckReport(packet, clean, { ...ctx, unattributedBefore: 1, unattributedAfter: 2 });
  assert.match(grew.needsEyes.join("|"), /new unattributed boundaries \(1 → 2\)/);
  const same = preCheckReport(packet, clean, { ...ctx, unattributedBefore: 1, unattributedAfter: 1 });
  assert.equal(same.decision?.verdict, "approve");
  assert.match(same.passed.join("|"), /no new unattributed boundary \(1\)/);
});
