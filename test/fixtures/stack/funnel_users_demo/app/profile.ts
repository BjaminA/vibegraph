import { getUser } from "../lib/db";

export function profile(id: string) {
  return getUser(id);
}
