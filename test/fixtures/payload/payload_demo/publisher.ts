// Publishes readings to a topic. Stated rule: every reading names its region.
export function publish(topic: string, payload: Record<string, unknown>): void {
  console.log(topic, JSON.stringify(payload));
}

export function sendRegion(region: string, value: number): void {
  publish("readings", { region, value });
}

export function sendNoRegion(value: number): void {
  publish("readings", { value });
}

export function sendSpread(base: Record<string, unknown>): void {
  publish("readings", { ...base, value: 1 });
}
