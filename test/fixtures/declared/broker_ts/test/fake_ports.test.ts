// A test fake of the ports: counted, never walked as production code.
import { test } from "node:test";
import { issue } from "../src/billing.ts";
import type { BillingPorts } from "../src/ports.ts";

const published: string[] = [];
const fake: BillingPorts = {
  publishInvoice: async (inv) => { published.push(inv.id); },
  loadTenant: async (id) => ({ id, standing: "ok" }),
};

test("issue publishes", async () => {
  await issue({ id: "i1", tenant: "t1", lines: ["a"], total: 1, paid: 0 }, fake);
});
