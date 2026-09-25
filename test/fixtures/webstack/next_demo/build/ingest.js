// COMPILED OUTPUT — a duplicate of scripts/ingest.mjs. Must never be parsed.
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export async function ingest(region) {
  const res = await pool.query("insert into orders (region) values ($1) returning id", [region]);
  return res.rows[0].id;
}
