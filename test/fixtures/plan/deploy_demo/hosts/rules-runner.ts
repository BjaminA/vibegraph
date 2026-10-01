#!/usr/bin/env -S npx tsx
// The runtime host: lives here, runs the logic in packages/rules.
import { classify } from "@acme/rules";

const input = Number(process.argv[2] ?? "3");
console.log(classify(input));
