// Deliberately part-broken: the second function does not parse, so the IR
// carries `degraded` and the files panel marks this file "partly parsed".
export function ok(): number {
  return 1;
}

export function bad( {
  return 2
