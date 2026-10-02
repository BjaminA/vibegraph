// Pure billing logic: every effect goes through the injected ports.
import type { BillingPorts, Invoice, PricingPort } from "./ports.ts";

export async function issue(inv: Invoice, ports: BillingPorts): Promise<void> {
  const tenant = await ports.loadTenant(inv.tenant);
  if (tenant.standing !== "ok") return;
  await ports.publishInvoice(inv);
  await ports.audit?.(`issued ${inv.id}`);
}

export async function quote(inv: Invoice, pricing: PricingPort): Promise<number> {
  return pricing.priceFor(inv);
}

export async function createInvoice(): Promise<void> {}
export async function getInvoice(): Promise<void> {}
