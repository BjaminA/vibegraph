#!/usr/bin/env node
import { applyTransition } from "../src/transitions";

async function main(): Promise<void> {
  console.log(await applyTransition(process.argv[2] ?? "o1"));
}

main();
