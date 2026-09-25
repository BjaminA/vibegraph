// api_demo/db.ts — the sourced-into side of the cross-file link: pg
// pool (db effect), a real fs read (fs effect), template literal
// (fstring valueKind), and an exported INTERFACE (M-SKILLS.3) — a
// construct that emitted no node at all until a work-run packet
// escalated because it could not be edited.
import { Pool } from "pg";
import { readFile } from "node:fs/promises";

/** One row of the users table, as callers see it. */
export interface UserRow {
  id: number;
  name: string;
}

const pool = new Pool();
const TABLE = "users";

/**
 * Read the seed file, then fetch up to `limit` users from postgres.
 * Returns the raw row objects.
 */
export async function queryUsers(limit): Promise<unknown[]> {
  const seed = await readFile("seed.json", "utf-8");
  const sql = `select * from ${TABLE} limit $1`;
  const result = await pool.query(sql, [limit]);
  return result.rows;
}

export async function insertUser(user) {
  const result = await pool.query("insert into users (name) values ($1) returning *", [user.name]);
  if (!result.rows[0]) {
    throw new Error("insert returned nothing");
  }
  return result.rows[0];
}
