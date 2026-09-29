export function applyDiscount(total: number, pct: number): number {
  return total * (1 - pct);
}

export function checkout(total: number): number {
  return applyDiscount(total, 0.1);
}
