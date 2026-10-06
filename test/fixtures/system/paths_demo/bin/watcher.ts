#!/usr/bin/env node
// Watches what the deployment lists, decided at run time.
import { readFileSync } from "node:fs";
import { ItemStore } from "../src/store";

async function main(): Promise<void> {
  const store = new ItemStore();
  const watched: string[] = JSON.parse(readFileSync("deployment.json", "utf8")).watched;
  for (const path of watched) {
    await store.watch(path, (doc) => console.log(path, doc));
  }
}

main();
