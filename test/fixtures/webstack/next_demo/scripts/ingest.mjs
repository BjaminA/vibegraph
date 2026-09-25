// Node ESM. The backend work lives in files like this one, and none of it
// was parsed before .mjs was registered.
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function ingest(region) {
  const res = await pool.query("insert into orders (region) values ($1) returning id", [region]);
  return res.rows[0].id;
}

async function main() {
  const id = await ingest(process.argv[2] ?? "eu-west");
  process.stdout.write(JSON.stringify({ id }) + "\n");
}

main();
