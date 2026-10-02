// The HTTP route table: data, not calls.
import { createInvoice, getInvoice } from "./billing.ts";

export const ROUTES = [
  { method: "POST", path: "/tenants/:tenantId/invoices", handler: createInvoice, auth: "tenant" },
  { method: "GET", path: "/tenants/:tenantId/invoices/:id", handler: getInvoice, auth: "tenant" },
];

// Built by a call, so it is not a literal table.
export const PATHS = ROUTES.map((r) => r.path);
