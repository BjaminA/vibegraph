// Bearer token extraction at the edge. The gateway never invents a
// token: it forwards the caller's, so the Python service's allow-list
// stays the single source of truth.
export function bearerToken(req): string | null {
  const header = req.headers?.authorization ?? "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
