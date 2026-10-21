import { drizzle } from "drizzle-orm/postgres-js";

const db = drizzle("postgres://localhost/demo");

export type User = { id: string; name: string };

export function getUser(id: string) {
  return db.select().from(id);
}

export function slugOf(name: string): string {
  return name.toLowerCase();
}
