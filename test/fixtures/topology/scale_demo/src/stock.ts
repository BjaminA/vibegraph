// The inventory service: the only writer of stock.
export async function recordStock(aisle: string, sku: string, qty: number): Promise<void> {
  await fetch(`https://store.example/stock_${aisle}/${sku}`, { method: "PUT", body: JSON.stringify({ qty }) });
}

export async function readPicks(aisle: string): Promise<unknown> {
  const res = await fetch(`https://store.example/picks_${aisle}`);
  return res.json();
}
