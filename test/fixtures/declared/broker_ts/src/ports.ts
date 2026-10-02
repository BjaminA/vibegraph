// What the billing logic needs from the outside world, injected.

export interface Invoice { id: string; tenant: string; lines: string[]; total: number; paid: number; approvedBy?: string }

export interface BillingPorts {
  /** publish an issued invoice on its tenant's topic */
  publishInvoice: (inv: Invoice) => Promise<void>;
  /** the tenant record */
  loadTenant(id: string): Promise<{ id: string; standing: string }>;
  /** an audit line */
  audit?: (line: string) => Promise<void>;
}

/** A port nothing in the project implements. */
export interface PricingPort {
  priceFor(inv: Invoice): Promise<number>;
}
