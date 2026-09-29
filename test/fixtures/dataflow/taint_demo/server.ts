// An express API: a shell string built from the query, and a query that is
// parameterised correctly.
import express from "express";
import { execSync } from "child_process";
import { Pool } from "pg";

const app = express();
const pool = new Pool();

export async function lookupRoute(req: express.Request, res: express.Response) {
  const domain = req.query.domain;
  const out = execSync(`nslookup ${domain}`);
  res.send(out.toString());
}

export async function ordersRoute(req: express.Request, res: express.Response) {
  const customer = req.params.customer;
  const result = await pool.query("SELECT * FROM orders WHERE customer = $1", [customer]);
  res.json(result.rows);
}

app.get("/lookup", lookupRoute);
app.get("/orders/:customer", ordersRoute);

// Found on a real codebase: a DESTRUCTURED argv at module level, read inside
// a function (a global in scope there) — and a regex's .exec(), which is not
// a shell exec whatever its name.
const [, , target] = process.argv;

export function deployTarget() {
  return execSync(`deploy --to ${target}`);
}

export function officerId(link: string) {
  const m = /^\/officers\/([^/]+)$/.exec(link);
  return m ? m[1] : null;
}
