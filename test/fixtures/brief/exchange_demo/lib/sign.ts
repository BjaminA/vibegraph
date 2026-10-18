// Signing: the decider signs every decision with its own key; anyone verifies
// it against the decider's published public key.
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

const DECIDER_PUBLIC_KEY = process.env.DECIDER_PUBLIC_KEY ?? "";

export function sign(doc: { body: unknown }, privateKeyPem: string): { body: unknown; sig: string } {
  const sig = edSign(null, Buffer.from(JSON.stringify(doc.body)), createPrivateKey(privateKeyPem)).toString("base64");
  return { body: doc.body, sig };
}

/** True only when the decider's key signed exactly this body. */
export function verify(doc: { body?: unknown; sig?: string } | null): boolean {
  if (!doc?.sig || doc.body === undefined) return false;
  return edVerify(null, Buffer.from(JSON.stringify(doc.body)), createPublicKey(DECIDER_PUBLIC_KEY), Buffer.from(doc.sig, "base64"));
}
