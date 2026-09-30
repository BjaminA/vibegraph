export class GuardedWriter {
  constructor(private key: string) {}
  write(v: number) { return v; }
}
