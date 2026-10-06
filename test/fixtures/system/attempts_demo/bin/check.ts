#!/usr/bin/env node
// A live check: the PLATFORM, not our code, must refuse these writes.
import { writeDoc } from "../lib/store";

async function attempt(what: () => Promise<unknown>, label: string): Promise<string> {
  try { await what(); return "ALLOWED"; } catch (e) { return `REFUSED (${label}: ${(e as Error).message})`; }
}

const results: Array<{ check: string; expect: string; got: string }> = [];

async function main(): Promise<void> {
  results.push({ check: "the app writes status", expect: "REFUSED", got: await attempt(() => writeDoc("status", "o1", { phase: "released" }), "write") });
  // control: the app's own request is allowed
  results.push({ check: "the app files its own request", expect: "ALLOWED", got: await attempt(() => writeDoc("requests", "o1", { by: "me" }), "write") });
  console.log(results);
}

main();
