// VARIABLES A PLATFORM PROVIDES (2026-10-22, the root-cause handoff RC8: "the
// environment census treats CI and platform variables as project
// configuration"). A runner, a host or a tool sets these itself; no project
// could declare them, so a rule that every variable read is declared could
// never pass while they were counted. A name matched here is shown as
// "provided by <platform>" and never as undeclared. Data, from each
// platform's own list of default environment variables; it can grow.
// Webview-safe.

/** [pattern, platform] — a name a person supplies (a credential: `_TOKEN`,
 *  `_KEY`, `_SECRET`) is never matched, see platformThatProvides. */
export const PLATFORM_ENV: ReadonlyArray<readonly [RegExp, string]> = [
  // docs.github.com/actions/reference/variables-reference#default-environment-variables
  [/^(GITHUB_[A-Z0-9_]+|RUNNER_[A-Z0-9_]+|ACTIONS_[A-Z0-9_]+)$/, "GitHub Actions"],
  // set to "true" by GitHub Actions, GitLab CI, CircleCI, Travis, Buildkite and others
  [/^CI$/, "the CI runner"],
  // docs.gitlab.com/ee/ci/variables/predefined_variables.html
  [/^(CI_[A-Z0-9_]+|GITLAB_CI|GITLAB_USER_[A-Z_]+)$/, "GitLab CI"],
  // circleci.com/docs/variables, docs.travis-ci.com/user/environment-variables
  [/^(CIRCLECI|CIRCLE_[A-Z0-9_]+|TRAVIS|TRAVIS_[A-Z0-9_]+|BUILDKITE|BUILDKITE_[A-Z0-9_]+)$/, "the CI runner"],
  // developers.cloudflare.com/pages/configuration/build-configuration/#environment-variables
  [/^(CF_PAGES|CF_PAGES_[A-Z_]+)$/, "Cloudflare Pages"],
  // vercel.com/docs/projects/environment-variables/system-environment-variables
  [/^(VERCEL|VERCEL_[A-Z0-9_]+|NEXT_PUBLIC_VERCEL_[A-Z0-9_]+)$/, "Vercel"],
  // docs.netlify.com/configure-builds/environment-variables/#read-only-variables
  [/^(NETLIFY|NETLIFY_[A-Z0-9_]+|DEPLOY_URL|DEPLOY_PRIME_URL|DEPLOY_ID)$/, "Netlify"],
  // fly.io/docs/machines/runtime-environment, render.com/docs/environment-variables, docs.railway.app/reference/variables
  [/^FLY_(APP_NAME|REGION|ALLOC_ID|MACHINE_ID|PUBLIC_IP|PRIVATE_IP|IMAGE_REF)$/, "Fly.io"],
  [/^(RENDER|RENDER_[A-Z0-9_]+|IS_PULL_REQUEST)$/, "Render"],
  [/^RAILWAY_[A-Z0-9_]+$/, "Railway"],
  // cloud.google.com/run/docs/container-contract#env-vars
  [/^K_(SERVICE|REVISION|CONFIGURATION)$/, "Google Cloud Run"],
  // kubernetes.io/docs/concepts/services-networking/service/#environment-variables
  [/^KUBERNETES_(SERVICE_HOST|SERVICE_PORT|SERVICE_PORT_HTTPS|PORT|PORT_443_TCP[A-Z_]*)$/, "Kubernetes"],
  // set in the shell Claude Code runs commands in
  [/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_PROJECT_DIR)$/, "Claude Code"],
];

const CREDENTIAL = /(_TOKEN|_KEY|_SECRET|_PASSWORD)$/;

/** The platform that sets a variable itself, or null. */
export function platformThatProvides(name: string): string | null {
  if (CREDENTIAL.test(name)) return null;
  return PLATFORM_ENV.find(([re]) => re.test(name))?.[1] ?? null;
}
