#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(new URL("../../worker/", import.meta.url));

function run(script: string) {
  return spawn(process.execPath, ["--import", "tsx", script], { stdio: "inherit" });
}

run("bin/job.ts");
run("api/src/server.ts");
const worker = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: WORKER, env: { ...process.env, WORKER_NAME: "demo", PORT: "3091" } });
worker.on("exit", () => console.log("worker done"));
