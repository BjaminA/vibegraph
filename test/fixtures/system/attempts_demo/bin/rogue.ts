#!/usr/bin/env node
// A probe: an identity with no grant tries to appoint the approver. The project
// declares this file negative (.vibegraph/operations.json).
import { writeDoc } from "../lib/store";

async function main(): Promise<void> {
  await writeDoc("approver", "current", { who: "rogue" });
}

main();
