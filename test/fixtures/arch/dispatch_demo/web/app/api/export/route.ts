import { execFile } from "node:child_process";
import path from "node:path";

const OPS = process.env.OPS_ROOT ?? "/srv";

// Exports the weekly bundle through the same dispatcher.
export async function GET() {
  const orchestrator = path.join(OPS, "ops/bin/orchestrator.sh");
  return new Promise<Response>((resolve) => {
    execFile("bash", [orchestrator, "reports/weekly.sh"], (err, stdout) => {
      resolve(new Response(err ? "failed" : stdout));
    });
  });
}
