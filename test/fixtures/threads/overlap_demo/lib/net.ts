// The network helpers the checks share.

export async function fetchStatus(url: string): Promise<number> {
  try {
    const res = await fetch(url);
    return res.status;
  } catch (err) {
    console.log(`fetch failed: ${(err as Error).message}`);
    return 0;
  }
}

export async function retry<T>(fn: () => Promise<T>, times: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
