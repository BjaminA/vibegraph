#!/usr/bin/env node
import { appoint } from "../lib/store";

async function main(): Promise<void> {
  await appoint(process.argv[2] ?? "run-1");
}

main();
