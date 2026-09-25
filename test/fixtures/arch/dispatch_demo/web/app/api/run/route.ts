import { execFile } from "node:child_process";
import path from "node:path";

const OPS = process.env.OPS_ROOT ?? "/srv";

// Runs one allow-listed report through the dispatcher.
export async function POST(req: Request) {
  const { script } = await req.json();
  const orchestrator = path.join(OPS, "ops/bin/orchestrator.sh");
  return new Promise<Response>((resolve) => {
    execFile("bash", [orchestrator, script], (err, stdout) => {
      resolve(new Response(err ? "failed" : stdout));
    });
  });
}
