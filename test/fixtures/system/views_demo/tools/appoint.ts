#!/usr/bin/env node
// The admin appoints the approver.
import { writeDoc } from "../lib/store";

async function main(): Promise<void> {
  await writeDoc("approver", "current", { who: process.argv[2] ?? "a1" });
}

main();
