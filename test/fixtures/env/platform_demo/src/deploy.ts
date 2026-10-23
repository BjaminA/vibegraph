export function deployLabel(): string {
  const sha = process.env.GITHUB_SHA ?? "local";
  const host = process.env.VERCEL_URL ?? "localhost";
  return `${sha}@${host}`;
}

export function apiKey(): string {
  return process.env.MY_API_KEY ?? "";
}
