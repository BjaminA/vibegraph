// An invoice's life as a transition table, and its approval as a decision tree.
import type { Invoice } from "./ports.ts";

const hasLines = (i: Invoice) => i.lines.length > 0;
const isPaid = (i: Invoice) => i.paid >= i.total;

export const INVOICE_TRANSITIONS = [
  { from: "DRAFT", to: "ISSUED", roles: ["billing"], requires: [hasLines] },
  { from: "ISSUED", to: "PAID", roles: ["ledger"], requires: [isPaid] },
  { from: "ISSUED", to: "VOID", roles: ["billing", "support"], requires: [] },
];

export const APPROVAL_TREE = {
  start: { question: "Is the customer in good standing?", yes: "amount", no: "REJECT", reads: ["Tenant.standing"] },
  amount: { question: "Is the total under the auto-approve limit?", yes: "APPROVE", no: "review", reads: ["Invoice.total", "Tenant.limit"] },
  review: { question: "Did a person approve it?", yes: "APPROVE", no: "REJECT", reads: ["Invoice.approvedBy"] },
};

export function checkStanding(i: Invoice): boolean { return i.tenant !== ""; }
export function checkAmount(i: Invoice): boolean { return i.total < 1000; }
export function checkReview(i: Invoice): boolean { return !!i.approvedBy; }

export const APPROVAL_CHECKS = { start: checkStanding, amount: checkAmount, review: checkReview };

export function transitionFor(from: string, to: string) {
  return INVOICE_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

// Not a state machine: a row without a target.
export const LEGACY_STATES = [{ from: "OPEN", to: "CLOSED" }, { from: "CLOSED" }];

// A tree no record evaluates: its nodes are found, their functions are not.
export const ESCALATION = {
  first: { yes: "second", no: "STOP" },
  second: { yes: "PAGE", no: "STOP" },
};
