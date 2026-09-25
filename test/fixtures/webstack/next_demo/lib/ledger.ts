// A PRIVATE SDK: no public table will ever carry @acme/ledger-client, so its
// role is STATED (c1 in .vibegraph/constraints.json) — or, with that entry
// gone, it is what the classify pass is asked about, from the evidence here:
// the import, the constructor, and the two calls through the instance.
import { LedgerClient } from "@acme/ledger-client";

const ledger = new LedgerClient({ tenant: process.env.LEDGER_TENANT });

/** The ONE place a posting is written to the ledger platform. */
export async function postEntry(ref: string, amount: number) {
  return ledger.post({ ref, amount });
}

export async function balance(account: string) {
  return ledger.balance(account);
}
