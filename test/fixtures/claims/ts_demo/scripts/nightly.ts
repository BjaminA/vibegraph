#!/usr/bin/env node
// The nightly job: build the site, then the index, then check the links.
import { execFileSync } from "node:child_process";

export function main(): void {
  execFileSync("node", ["scripts/build_site.mjs"], { stdio: "inherit" });
  execFileSync("node", ["scripts/build_index.mjs"], { stdio: "inherit" });
  execFileSync("node", ["scripts/check_links.mjs"], { stdio: "inherit" });
}

main();
