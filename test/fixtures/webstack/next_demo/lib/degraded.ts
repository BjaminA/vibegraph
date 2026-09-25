// This file parses PARTIALLY on purpose: the trailing construct is not
// valid TypeScript, so the frontend drops it and still emits an IR for
// everything above. Before M-CMD.1 that damage was invisible in the IR.
import { refund } from "@/lib/volt";

export function settle(reference: string) {
  return refund(reference);
}

export function broken(  {{{ = = =
