// A tiny TTL cache so the dashboard's polling does not hammer upstream.
const store = new Map<string, { until: number; value: unknown }>();

export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.until > now) {
    return hit.value as T;
  }
  const value = await load();
  store.set(key, { until: now + ttlSeconds * 1000, value });
  return value;
}

export function invalidate(prefix: string): number {
  let dropped = 0;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      dropped += 1;
    }
  }
  return dropped;
}
