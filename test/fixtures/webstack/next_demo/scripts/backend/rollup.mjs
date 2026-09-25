#!/usr/bin/env node
// A Node script run as a command (`node scripts/backend/rollup.mjs <region>`):
// the shebang marks it executable, `main` is defined and called at top
// level, so the entry seeds on main (M-FLOW.1). It names no framework.
import { Pool } from "pg";

const pool = new Pool();

async function main() {
  const region = process.argv[2] ?? "all";
  const res = await pool.query("select sum(amount) from orders where region = $1", [region]);
  process.stdout.write(JSON.stringify(res.rows[0]) + "\n");
}

main().catch((e) => { process.stderr.write(String(e) + "\n"); process.exit(1); });
