export async function getPrices(): Promise<unknown> {
  const res = await fetch("/api/prices");
  return res.json();
}
