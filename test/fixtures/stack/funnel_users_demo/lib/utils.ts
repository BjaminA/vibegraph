// A grab-bag module: one class-name helper most files import, and a fetch
// wrapper a few do. Importing it for cn() is not using fetch.
export function cn(...parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

export async function fetcher(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

// wraps fetch through fetcher
export function loadItem(id: string): Promise<unknown> {
  return fetcher(`/api/items/${id}`);
}

function withRetry<T>(fn: T): T {
  return fn;
}

// passes the wrapper as a value
export const loader = withRetry(loadItem);
