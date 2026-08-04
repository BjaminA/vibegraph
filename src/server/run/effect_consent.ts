// M-RUN SM3 — consent integrity for the side-effect run gate.
//
// "Don't trust the client" applied to CONSENT. A confirmed effectful run must
// carry an explicit, SCOPED consent token bound to (this node + this exact set
// of detected effects). The server MINTS the token at propose time and
// RE-VALIDATES it at run time against a FRESH scan — so:
//
//   - it is unforgeable: HMAC with a per-process secret the client never sees;
//   - it is scoped: the token authorizes ONE node + ONE effect set, never a
//     blanket "client may run";
//   - it self-invalidates: if the code changed between propose and confirm, the
//     fresh scan yields a different effect set, the recomputed HMAC differs, and
//     the stale token is rejected — the user must re-consent to the new effects.
//
// The secret is per-process (regenerated each boot) — tokens deliberately do
// not survive a restart; the client simply re-requests consent.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { EffectOffense } from "../../shared/protocol";

let _secret: Buffer | null = null;
function secret(): Buffer {
  if (!_secret) _secret = randomBytes(32);
  return _secret;
}

// Order-independent canonical serialization of the consented scope. Both mint
// and verify run this, so the token is stable regardless of scan walk order.
export function canonicalizeEffects(nodeId: string, offenses: EffectOffense[]): string {
  const rows = offenses
    .map((o) => `${o.kind}|${o.effectKind ?? ""}|${o.target}|${o.file}|${o.line}`)
    .sort();
  return `${nodeId}\n${rows.join("\n")}`;
}

export function mintEffectConsent(nodeId: string, offenses: EffectOffense[]): string {
  return createHmac("sha256", secret()).update(canonicalizeEffects(nodeId, offenses)).digest("hex");
}

// True iff `token` is the server's own token for EXACTLY (nodeId, offenses).
// Constant-time compare; any tamper / wrong node / changed effect set fails.
export function verifyEffectConsent(
  nodeId: string,
  offenses: EffectOffense[],
  token: string | undefined | null,
): boolean {
  if (!token) return false;
  const expected = mintEffectConsent(nodeId, offenses);
  return safeTokenEqual(token, expected);
}

function safeTokenEqual(token: string, expected: string): boolean {
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ── Sitting-2 — session trust for UNVERIFIABLE calls ────────────────────
// A dynamic/unresolved/external-unprovable offense is a call whose purity
// the floor cannot prove — commonly harmless library dispatch (the sitting's
// torch training loop), but the scan cannot even NAME the library: the
// receiver is a runtime-bound variable, and that unknowability IS the
// refusal. So a per-library trust ("trust all torch calls") would be a
// dishonest label; the honest grant is per-CATEGORY: "stop asking about
// unverifiable calls this session". PROVEN effects (kind === "effect":
// fs/db/http/subprocess) always keep per-run consent.
//
// Consent-integrity rules carry over unchanged:
//   - the scan_effects floor is untouched — it keeps reporting every offense;
//     trust only filters which offenses still GATE, and runs stay labelled;
//   - the grant token is server-minted over the exact offense set a gate
//     showed, so trust can only be granted from a rendered gate;
//   - the grant dies with the process (same lifetime as the secret).

let _unverifiedTrust = false;

// Proven effects are never trustable; only unprovable-purity calls are.
export function isTrustableOffense(o: EffectOffense): boolean {
  return o.kind !== "effect";
}

export function hasUnverifiedTrust(): boolean {
  return _unverifiedTrust;
}

// The offenses that still gate once session trust is applied.
export function gatedOffenses(offenses: EffectOffense[]): EffectOffense[] {
  return _unverifiedTrust ? offenses.filter((o) => !isTrustableOffense(o)) : offenses;
}

export function mintUnverifiedTrust(scope: string, offenses: EffectOffense[]): string {
  return createHmac("sha256", secret())
    .update(`trust-unverified\n${canonicalizeEffects(scope, offenses)}`)
    .digest("hex");
}

// Grant session trust — only against the server's own token for a gate that
// actually showed these offenses (fresh-scan re-derived, like every consent).
// Returns whether the grant took.
export function grantUnverifiedTrust(
  scope: string,
  offenses: EffectOffense[],
  token: string | undefined | null,
): boolean {
  if (!token) return false;
  if (!safeTokenEqual(token, mintUnverifiedTrust(scope, offenses))) return false;
  _unverifiedTrust = true;
  return true;
}

// Test seam — sessions are per-process; tests reset between cases.
export function _resetUnverifiedTrustForTest(): void {
  _unverifiedTrust = false;
}

// ── M-RUN2.3 — example-data consent ─────────────────────────────────────
// A synthesized data file is a second consent SCOPE, separate from the
// effect scope: the token binds (node + relative path + the CONTENT hash),
// so what runs is byte-identical to what the user saw — an edited or
// swapped file invalidates the approval. Same per-process secret/HMAC.

export function canonicalizeData(nodeId: string, relPath: string, content: string): string {
  return `data\n${nodeId}\n${relPath}\n${createHash("sha256").update(content, "utf-8").digest("hex")}`;
}

export function mintDataConsent(nodeId: string, relPath: string, content: string): string {
  return createHmac("sha256", secret()).update(canonicalizeData(nodeId, relPath, content)).digest("hex");
}

export function verifyDataConsent(
  nodeId: string,
  relPath: string,
  content: string,
  token: string | undefined | null,
): boolean {
  if (!token) return false;
  return safeTokenEqual(token, mintDataConsent(nodeId, relPath, content));
}
