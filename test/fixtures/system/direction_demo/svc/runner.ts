#!/usr/bin/env node
// The release runner: decides each order as the account it was started with.
import { release } from "../lib/logic";
import { remoteStore } from "../lib/remote";

async function main(): Promise<void> {
  const config = process.env.RUN_CONFIG_PATH ?? "run.json";
  await release(remoteStore("https://ledger.example"), config);
}

main();
