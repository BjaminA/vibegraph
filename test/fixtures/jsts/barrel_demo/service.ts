// Fields that hold instances (2026-10-01): this.<field>.<method>() follows
// the class the field names, and only when the class says which one.
import { GuardedWriter } from "./lib";
import { Base } from "./base";
import { Local } from "./app";

export class Service {
  private readonly writer: GuardedWriter;
  private local;
  private base: Base;
  constructor(private readonly backup: GuardedWriter) {
    this.writer = new GuardedWriter("k");
    this.local = new Local();
    this.base = new Base();
  }
  save() {
    this.writer.write(1);
    this.backup.write(2);
    this.local.run(3);
    this.base.m();
  }
}

export class Twice {
  private local;
  constructor() { this.local = new Local(); }
  reset() { this.local = new Local(); }
  go() { this.local.run(4); }
}
