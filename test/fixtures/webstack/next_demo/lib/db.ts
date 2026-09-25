// The db funnel: the one place a pool is opened.
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function listOrders(region: string) {
  const res = await pool.query("select id, region from orders where region = $1", [region]);
  return res.rows;
}

export async function insertOrder(region: string, reference: string) {
  const res = await pool.query("insert into orders (region, reference) values ($1, $2) returning id", [region, reference]);
  return res.rows[0].id;
}
