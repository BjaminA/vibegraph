#!/usr/bin/env node
import { record } from "../src/ledger.ts";
import { mirror } from "../src/mirror.ts";
import { remember } from "../src/cache.ts";

const entry = { amount: Number(process.argv[2] ?? 1) };
await record(entry);
await mirror("latest", entry);
await remember("latest", String(entry.amount));
