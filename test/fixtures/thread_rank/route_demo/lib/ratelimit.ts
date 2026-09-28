const buckets = new Map<string, number>();

/** true when this caller asked again inside a second. */
export function rateLimit(ip: string): boolean {
  const now = Date.now();
  const last = buckets.get(ip) ?? 0;
  buckets.set(ip, now);
  return now - last < Math.max(1000, 0);
}
