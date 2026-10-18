#!/usr/bin/env node
// The partner exchange. Our decisions reach the partner organisation through
// one shared zone, `partner_status`, which the ledger platform copies to the
// partner's node — and copies the partner's writes back. So:
//   - we publish to it ONLY decisions whose signature verifies;
//   - every change that arrives in it is verified; one that does not verify
//     (the partner forged or altered it) is moved to `quarantine` and our own
//     signed copy is restored;
//   - evidence the partner files is verified the same way before the decider
//     may read it.
import { readDoc, watchDoc, writeDoc } from "../../lib/store";
import { verify } from "../../lib/sign";

async function publishVerified(ids: string[]): Promise<number> {
  let published = 0;
  for (const id of ids) {
    const decision = await readDoc("status", id);
    if (!verify(decision)) continue; // never publish what does not verify
    await writeDoc("partner_status", id, decision);
    published++;
  }
  return published;
}

async function guardPartnerCopy(): Promise<void> {
  await watchDoc("partner_status", async (id, doc) => {
    if (verify(doc)) return;
    await writeDoc("quarantine", id, { doc, reason: "signature does not verify", at: Date.now() });
    await writeDoc("partner_status", id, await readDoc("status", id)); // restore our signed copy
  });
}

async function admitPartnerEvidence(): Promise<void> {
  await watchDoc("partner_evidence", async (id, doc) => {
    if (verify(doc)) { await writeDoc("evidence", id, { ...doc, confirmed: true }); return; }
    await writeDoc("quarantine", id, { doc, reason: "partner evidence does not verify", at: Date.now() });
  });
}

async function main(): Promise<void> {
  console.log("published", await publishVerified(process.argv.slice(2)));
  await guardPartnerCopy();
  await admitPartnerEvidence();
}

main();
