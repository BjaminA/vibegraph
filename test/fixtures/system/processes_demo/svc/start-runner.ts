#!/usr/bin/env node
// Starts a runner with an account made for this run only.
import { fork } from "node:child_process";

async function createRunAccount(name: string): Promise<string> {
  return `${name}.json`;
}

async function main(): Promise<void> {
  const cfg = await createRunAccount(`runner-${Date.now()}`);
  fork("svc/runner.ts", [], { env: { ...process.env, RUN_CONFIG_PATH: cfg } });
}

main();
