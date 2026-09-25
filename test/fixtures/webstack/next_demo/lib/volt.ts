// A funnel wrapping a tool no role table knows: three files import it and
// none of them touches @tdxvolt/* directly. THIS is the shape that was
// missed — the wrapper is the boundary, and the tool has no role.
import { VoltClient } from "@tdxvolt/volt-client-web";

const client = new VoltClient({ relay: process.env.VOLT_RELAY });

/** The ONE place a payment command is built. */
export async function chargeCard(token: string, amount: number) {
  return client.command("charge", { token, amount });
}

export async function refund(reference: string) {
  return client.command("refund", { reference });
}

/** Run a backend script THROUGH the platform: the literal names the script,
 *  and that literal is the join to its thread (M-FLOW.2). */
export async function exportOrders(region: string) {
  return client.command("bash", ["orders/export_orders.sh", region]);
}

/** The script name may come from the environment; the literal is the
 *  default and the only static fact — a `??` composite whose 80-char
 *  preview would cut it (M-FLOW.5 records the literal). A script nothing in
 *  this tree is: the crossing stays unmatched and says so. */
const NIGHTLY_SCRIPT = process.env.NIGHTLY_SCRIPT ?? "orders/nightly_rollup.sh";

export async function nightly() {
  return client.command("bash", [NIGHTLY_SCRIPT]);
}
