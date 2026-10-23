import { execFileSync } from "node:child_process";

const BASE = process.env.PAYMENTS_BASE ?? "https://api.stripe.com";

export async function publish(tag: string): Promise<void> {
  execFileSync("gh", ["release", "create", tag], { stdio: "inherit" });
  execFileSync("git", ["push", "--tags"]);
  const res = await fetch(`${BASE}/v1/charges`, { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  console.log(res.status);
}

publish(process.argv[2] ?? "v0");
