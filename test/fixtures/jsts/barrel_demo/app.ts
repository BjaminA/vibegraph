// A service written the way TypeScript projects usually are: imported through
// barrel files (lib/index.ts), with work done by class instances.
import { GuardedWriter, assist } from "./lib";
import { Base } from "./base";
import { clash } from "./dup";

export class Local { run(x: number) { return x; } }

export function main(typed: GuardedWriter, base: Base, flag: boolean) {
  const writer = new GuardedWriter("k");
  writer.write(1);
  const l = new Local();
  l.run(2);
  typed.write(3);
  base.m();
  let either = new Local();
  if (flag) either = new Local();
  either.run(4);
  assist();
  clash();
}
