#!/usr/bin/env node
// Tags an item.
import { ItemStore } from "../src/store";
import { tagKey } from "../src/paths";

async function main(): Promise<void> {
  const store = new ItemStore();
  await store.write(tagKey(process.argv[2] ?? "x"), { tags: process.argv.slice(3) });
}

main();
