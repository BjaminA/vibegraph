#!/usr/bin/env node
// Starts the app and the check, each with its own environment.
import { spawn } from "node:child_process";

function start(): void {
  spawn(process.execPath, ["app/server.ts"], { env: { ...process.env, PERSON: "clerk-1" } });
  spawn(process.execPath, ["bin/check.ts"], { env: { ...process.env, PORT: "3001" } });
}

start();
