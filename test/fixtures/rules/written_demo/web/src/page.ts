import { getPrices } from "./api";

export async function render(): Promise<string> {
  const prices = await getPrices();
  return JSON.stringify(prices);
}
