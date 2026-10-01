// A one-off: awaits at the top level.
import { run } from "./lib";
async function migrate(): Promise<void> { run("migrate"); }
await migrate();
