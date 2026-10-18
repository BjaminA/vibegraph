#!/usr/bin/env node
// The decider: the only process that decides an order's status, and it signs
// every decision it writes.
import { readDoc, writeDoc } from "../../lib/store";
import { sign } from "../../lib/sign";

const KEY = process.env.DECIDER_PRIVATE_KEY ?? "";

async function decide(id: string): Promise<string> {
  const request = await readDoc("requests", id);
  const evidence = await readDoc("evidence", id);
  const phase = request && evidence?.confirmed ? "released" : "held";
  await writeDoc("status", id, sign({ body: { id, phase, at: Date.now() } }, KEY));
  return phase;
}

async function main(): Promise<void> {
  for (const id of process.argv.slice(2)) console.log(id, await decide(id));
}

main();
