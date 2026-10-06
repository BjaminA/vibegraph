#!/usr/bin/env node
// The sweeper: clears stale status entries every night.
import { remoteStore } from "../lib/remote";

async function main(): Promise<void> {
  await remoteStore("https://ledger.example").write("status", "stale", {});
}

main();
