import { slugOf, type User } from "../lib/db";

export function label(u: User): string {
  return slugOf(u.name);
}
