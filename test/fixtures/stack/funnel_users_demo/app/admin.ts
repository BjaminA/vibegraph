import { getUser } from "../lib/db";

export function adminView(id: string) {
  return getUser(id);
}
