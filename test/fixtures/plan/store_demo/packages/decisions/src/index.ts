// Pure decision logic: no transport, no store.
export interface Request {
  amount: number;
}

/** Decide a request. */
export function decide(req: Request): "approve" | "review" {
  return req.amount < 100 ? "approve" : "review";
}
