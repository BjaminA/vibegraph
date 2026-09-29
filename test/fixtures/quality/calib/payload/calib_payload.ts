// Calibration samples for the `payload-keys` verb (scripts/quality_calibrate.mjs).
// Rule under test: every publish() payload carries `region` and never `password`.
// good* comply, bad* break it where the keys are visible, unv* hide the keys
// (a variable, a spread, a computed key) and must read unverifiable.

export function publish(topic: string, payload: Record<string, unknown>): void {
  void topic;
  void payload;
}

export function goodLiteral(region: string): void {
  publish("readings", { region, value: 1 });
}

export function goodPair(r: string): void {
  publish("readings", { "region": r, value: 2 });
}

export function unvVariable(payload: Record<string, unknown>): void {
  publish("readings", payload);
}

export function unvSpread(base: Record<string, unknown>): void {
  publish("readings", { ...base, value: 1 });
}

export function unvComputed(key: string): void {
  publish("readings", { [key]: 1, value: 1 });
}

export function badMissing(): void {
  publish("readings", { value: 1 });
}

export function badForbidden(region: string, secret: string): void {
  publish("readings", { region, password: secret });
}
