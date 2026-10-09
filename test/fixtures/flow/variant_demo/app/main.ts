#!/usr/bin/env node
// Asks the tool for one paid report.
import { spawnSync } from "node:child_process";
import { commandFor } from "./command.ts";

const r = spawnSync(commandFor(true), ["report"], { encoding: "utf-8" });
console.log(r.stdout);
