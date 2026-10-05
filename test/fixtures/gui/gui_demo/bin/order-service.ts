#!/usr/bin/env node
import { decide } from "../order_service/decide";

async function main(): Promise<void> {
  const id = process.argv[2] ?? "r1";
  console.log(await decide(id));
}

main();
