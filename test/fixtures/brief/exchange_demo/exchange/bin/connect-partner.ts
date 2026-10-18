#!/usr/bin/env node
// Admin step: share the exchange zones with a partner's node (once per partner).
import { shareZone } from "../../lib/share";

async function main(): Promise<void> {
  const node = process.argv[2] ?? "partner-node";
  await shareZone("partner_status", node);
  await shareZone("partner_evidence", node);
}

main();
