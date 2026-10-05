#!/usr/bin/env node
// A run of checks, the shape where container boxes used to cover cards: one
// helper (`check`) called from many `if` blocks, shared externals
// (`setTimeout`, `console.log`) inside `try` blocks in several functions,
// calls nested in other calls' arguments, and cards with long previews.
import { readFileSync } from "node:fs";
import { fetchStatus, retry } from "../lib/net.ts";

const flags = new Set(process.argv.slice(2));
const results: { name: string; ok: boolean; detail: string }[] = [];

async function check(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  try {
    const detail = (await fn()) ?? "";
    results.push({ name, ok: true, detail });
    return true;
  } catch (err) {
    results.push({ name, ok: false, detail: (err as Error).message });
    return false;
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function readConfig(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.log(`no config at ${path}: ${(err as Error).message}`);
    return {};
  }
}

async function main(): Promise<number> {
  const config = readConfig(process.env.CHECKS_CONFIG ?? "checks.json");
  const ok = await check("the service answers", async () => {
    const status = await retry(() => fetchStatus(String(config.url ?? "http://localhost:8080")), 3);
    if (status !== 200) throw new Error(`status ${status}`);
  });
  if (!ok) {
    console.log("the service is down; nothing else is checked");
    return 2;
  }
  if (flags.has("--slow")) {
    await check("a slow answer still arrives", async () => {
      try {
        await wait(Math.max(100, Number(process.env.SLOW_MS ?? 250)));
        const status = await fetchStatus(String(config.url));
        if (status !== 200) throw new Error(`slow status ${status} after waiting for the answer to arrive`);
      } finally {
        console.log("slow check finished");
      }
    });
  }
  if (flags.has("--retry")) {
    try {
      await check("retries give up", async () => {
        await retry(() => fetchStatus("http://localhost:1"), 2);
      });
    } catch (err) {
      if (err instanceof TypeError) throw new Error(`retry check broke: ${err.message} — a long reason so the card's preview wraps`);
    }
  }
  if (flags.has("--report")) {
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} ${r.detail}`);
  }
  await wait(10);
  return results.every((r) => r.ok) ? 0 : 1;
}

main().then((code) => process.exit(code));
