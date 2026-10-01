// Reads its arguments inside main(), which the file calls when loaded.
import { run } from "./lib";
async function main(): Promise<void> {
  const [target] = process.argv.slice(2);
  run(target);
}
main();
