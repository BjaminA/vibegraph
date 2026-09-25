// Payload contract for POST /orders — what the gateway accepts before
// forwarding. Pure: no effects, no external calls.
export function validateOrderInput(body): string[] {
  const problems = [];
  if (typeof body?.customer !== "string" || body.customer.length === 0) {
    problems.push("customer must be a non-empty string");
  }
  if (!Array.isArray(body?.items) || body.items.length === 0) {
    problems.push("items must be a non-empty array");
  }
  for (const item of body?.items ?? []) {
    if (typeof item.sku !== "string") {
      problems.push("item.sku must be a string");
    }
  }
  return problems;
}
