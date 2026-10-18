// Provisions the credits database. It must have NO user grants at all: the
// service reads it through its own role, and a grant to a user is how the
// last credential leak happened.
import { Client } from "pg";

export async function provisionCreditsDb(conn: Client): Promise<void> {
  await conn.query("CREATE DATABASE credits");
  await conn.query("REVOKE ALL ON DATABASE credits FROM PUBLIC");
}

export async function grantServiceRole(conn: Client): Promise<void> {
  await conn.query("GRANT CONNECT ON DATABASE credits TO service_role");
}
