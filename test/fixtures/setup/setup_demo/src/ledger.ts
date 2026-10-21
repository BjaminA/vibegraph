import { postEntry } from "@acme/ledger-client";

export function record(entry: { amount: number }) {
  return postEntry(entry);
}
