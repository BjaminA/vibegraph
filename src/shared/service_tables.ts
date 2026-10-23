// EXTERNAL SERVICES, AS DATA (2026-10-22, the root-cause handoff RC3). What a
// piece of evidence says about the service behind it: a program a project
// runs, a host it calls, a credential it reads, a deploy file it keeps. Read
// by src/server/service_inventory.ts. Every table can grow; a name no table
// knows is still listed, as itself ("runs pagemaker", "calls api.example.com"),
// never folded into "subprocess" or dropped. Webview-safe.

/** A program → the service running it reaches. From each tool's own
 *  documentation: the CLI is the vendor's client for that platform. Programs
 *  that reach no single service (git, curl, docker, ssh) are not here: the
 *  inventory lists them as programs, and their targets come from other
 *  evidence (a remote, a URL). */
export const EXECUTABLE_SERVICES: Readonly<Record<string, string>> = {
  gh: "GitHub", hub: "GitHub", glab: "GitLab",
  aws: "AWS", sam: "AWS", cdk: "AWS",
  gcloud: "Google Cloud", gsutil: "Google Cloud", bq: "Google Cloud",
  az: "Azure", func: "Azure",
  wrangler: "Cloudflare", cloudflared: "Cloudflare",
  vercel: "Vercel", netlify: "Netlify", flyctl: "Fly.io", fly: "Fly.io",
  heroku: "Heroku", railway: "Railway", doctl: "DigitalOcean",
  firebase: "Firebase", supabase: "Supabase",
  stripe: "Stripe", claude: "Anthropic", "huggingface-cli": "Hugging Face",
};

/** A host, matched on its last labels → the service. The vendor's API and
 *  site domains; a host no row matches is listed as the host itself. */
export const HOST_SERVICES: ReadonlyArray<readonly [string, string]> = [
  ["github.com", "GitHub"], ["githubusercontent.com", "GitHub"], ["gitlab.com", "GitLab"],
  ["openai.com", "OpenAI"], ["anthropic.com", "Anthropic"], ["huggingface.co", "Hugging Face"],
  ["amazonaws.com", "AWS"], ["googleapis.com", "Google Cloud"], ["azure.com", "Azure"], ["windows.net", "Azure"],
  ["cloudflare.com", "Cloudflare"], ["workers.dev", "Cloudflare"], ["r2.dev", "Cloudflare"],
  ["vercel.com", "Vercel"], ["vercel.app", "Vercel"], ["netlify.com", "Netlify"], ["netlify.app", "Netlify"], ["fly.dev", "Fly.io"],
  ["stripe.com", "Stripe"], ["slack.com", "Slack"], ["twilio.com", "Twilio"], ["sendgrid.com", "SendGrid"],
  ["supabase.co", "Supabase"], ["firebaseio.com", "Firebase"], ["sentry.io", "Sentry"],
];

/** An environment variable that holds a service's credential → the service.
 *  The names each vendor's SDK reads by default. */
export const KEY_SERVICES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^OPENAI_(API_KEY|ORG(ANIZATION)?|PROJECT)/, "OpenAI"], [/^ANTHROPIC_(API_KEY|AUTH_TOKEN)/, "Anthropic"],
  [/^(GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT|GH_PAT)$/, "GitHub"], [/^GITLAB_TOKEN$/, "GitLab"],
  [/^STRIPE_(SECRET|API|PUBLISHABLE)/, "Stripe"], [/^SLACK_(BOT_TOKEN|TOKEN|WEBHOOK)/, "Slack"],
  [/^(CLOUDFLARE_(API_TOKEN|API_KEY|ACCOUNT_ID)|CF_API_TOKEN)$/, "Cloudflare"],
  [/^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)$/, "AWS"],
  [/^GOOGLE_(APPLICATION_CREDENTIALS|API_KEY)$/, "Google Cloud"], [/^AZURE_(CLIENT_SECRET|STORAGE_CONNECTION_STRING)$/, "Azure"],
  [/^(HF_TOKEN|HUGGING_FACE_HUB_TOKEN|HUGGINGFACE_TOKEN)$/, "Hugging Face"],
  [/^TWILIO_(AUTH_TOKEN|ACCOUNT_SID)$/, "Twilio"], [/^SENDGRID_API_KEY$/, "SendGrid"], [/^SENTRY_DSN$/, "Sentry"],
  [/^VERCEL_TOKEN$/, "Vercel"], [/^NETLIFY_AUTH_TOKEN$/, "Netlify"], [/^FLY_API_TOKEN$/, "Fly.io"],
];

/** A deploy file → the platform that reads it (each platform's documented
 *  config file name). */
export const DEPLOY_FILES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^wrangler\.(toml|json|jsonc)$/, "Cloudflare"], [/^vercel\.json$/, "Vercel"],
  [/^netlify\.toml$/, "Netlify"], [/^fly\.toml$/, "Fly.io"], [/^Procfile$/, "a Procfile host (Heroku-style)"],
  [/^app\.ya?ml$/, "Google App Engine"],
];

/** A workflow step's words → the service the step deploys to or calls: an
 *  action's owner (`uses: cloudflare/wrangler-action`) or a CLI in `run:`. */
export const WORKFLOW_SERVICES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcloudflare\/|\bwrangler\b/, "Cloudflare"], [/\baws-actions\//, "AWS"], [/\bgoogle-github-actions\//, "Google Cloud"],
  [/\bazure\//, "Azure"], [/\bamondnet\/vercel|\bvercel\b/, "Vercel"], [/\bnetlify\b/, "Netlify"],
  [/\bsuperfly\/|\bflyctl\b/, "Fly.io"], [/\bgh (api|release|pr|issue|workflow)\b/, "GitHub"],
];

export function serviceOfHost(host: string): string | null {
  const h = host.toLowerCase();
  return HOST_SERVICES.find(([suffix]) => h === suffix || h.endsWith(`.${suffix}`))?.[1] ?? null;
}
export const serviceOfKey = (name: string): string | null => KEY_SERVICES.find(([re]) => re.test(name))?.[1] ?? null;
export const serviceOfExecutable = (exe: string): string | null => EXECUTABLE_SERVICES[exe] ?? null;
