#!/usr/bin/env node
/**
 * Stub `claude -p --output-format json` for M-ARCH.4 (the architecture
 * proposal). Answers the proposal prompt with a fixed reply built against
 * test/fixtures/webstack/next_demo, deliberately MIXED so the grounding
 * floor has work to do:
 *
 *   - g-public   cites docker-compose.yml:2 and :7 (both shown) — grounded;
 *   - g-private  cites docker-compose.yml:13 and an invented k8s line — the
 *                invented one is dropped, the group survives with one;
 *   - g-volt     cites only the node it wraps — circular, dropped, so it is
 *                kept as INFERRED (ghosted);
 *   - g-invented wraps only a node that does not exist — refused whole;
 *   - a name for cluster:scripts:. citing the command edge — grounded;
 *   - a name for a node that does not exist — refused.
 *
 * Any other prompt gets an empty result (the caller reports "returned
 * nothing"), so a stray README/skill spawn in the e2e never receives this.
 * Automated tests never spawn the real `claude`.
 */
const prompt = process.argv[process.argv.length - 1] ?? "";
// A real proposal takes a minute; the working state is only observable if
// the stub takes long enough to be seen (FAKE_ARCH_DELAY_MS, e2e only).
if (process.env.FAKE_ARCH_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ARCH_DELAY_MS)));
if (process.env.FAKE_PROMPT_CAPTURE) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.FAKE_PROMPT_CAPTURE, prompt + "\n\x00\n");
}
const CMD_EDGE = "cluster:web:.->cluster:scripts:.:command:Volt · WebSocket · command";
const reply = {
  groups: [
    { id: "g-public", kind: "network", label: "public network", wraps: ["cluster:web:.", "cluster:mcp:."], evidence: ["docker-compose.yml:2", "docker-compose.yml:7"] },
    { id: "g-private", kind: "network", label: "private network", wraps: ["tool:pg"], evidence: ["docker-compose.yml:13", "k8s/db.yaml:9"] },
    { id: "g-volt", kind: "host", label: "Volt host", wraps: ["cluster:scripts:."], evidence: ["cluster:scripts:."] },
    { id: "g-invented", kind: "host", label: "a host nobody wrote", wraps: ["cluster:ghost:."], evidence: ["docker-compose.yml:2"] },
  ],
  names: {
    "cluster:scripts:.": { label: "Volt host scripts", evidence: [CMD_EDGE] },
    "cluster:nowhere:.": { label: "nothing", evidence: [] },
  },
  primaryPath: { entryPoints: ["app/dashboard/page.tsx:DashboardPage"], evidence: ["cluster:web:."] },
  narrative: "A Next.js app on the public network runs backend scripts on the Volt host through the Volt web client; Postgres sits on the private network.",
};
// A revision (Modify) is marked visibly, so the gate's Modify is proven to re-draft.
if (prompt.includes("The person asked you to revise")) reply.groups[0].label = "public network (revised)";
const text = prompt.includes("DEPLOYMENT and TRUST grouping") ? "```json\n" + JSON.stringify(reply, null, 2) + "\n```" : "";
process.stdout.write(JSON.stringify({ result: text, is_error: false, session_id: "fake-arch" }));
process.exit(0);
