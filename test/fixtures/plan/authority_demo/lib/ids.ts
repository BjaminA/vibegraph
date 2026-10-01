// Ids encode their family. These are the only producers.

/** The id of a verdict. */
export function verdictId(requestId: string): string {
  return `verdict:${requestId}`;
}

/** The id of an audit event. */
export function eventId(kind: string, subject: string): string {
  return `event:${kind}:${subject}`;
}
